/**
 * Stateless Chat API Endpoint
 *
 * POST /api/chat - Send message, receive SSE stream
 *
 * This endpoint:
 * 1. Receives full state from client (messages + storeState)
 * 2. Runs single-pass generation
 * 3. Streams events as SSE (text deltas + tool calls)
 *
 * Fully stateless: interruption is handled by the client aborting
 * the fetch request, which triggers req.signal on the server side.
 */

import { NextRequest } from 'next/server';
import type { StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import type { ThinkingConfig } from '@/lib/types/provider';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { resolveModel } from '@/lib/server/resolve-model';
import {
  createLearningRecordExtractJob,
  createGatewayAIMessage,
  createGatewayAISession,
  listGatewayAISessions,
} from '@/lib/server/anotherme2-gateway';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/session';
import { buildLearningContext } from '@/lib/server/learning-context';
import { createLearningContext, type LearningContext } from '@/lib/types/learning-context';
import { createDefaultRuntime, type CapabilityHandler } from '../orchestration/capability-runtime';
import type { CapabilityId as RuntimeCapabilityId } from '../orchestration/capability-registry';
import { globalStreamBus } from '../orchestration/stream-bus';
import { aiTutorChatHandler } from '../orchestration/handlers/chat-handler';
import { deepSolveHandler } from '../orchestration/handlers/deep-solve-handler';
import { quizPracticeHandler } from '../orchestration/handlers/quiz-practice-handler';
import { mathAnimatorHandler } from '../orchestration/handlers/math-animator-handler';
import { visualizeHandler } from '../orchestration/handlers/visualize-handler';
import { deepResearchHandler } from '../orchestration/handlers/deep-research-handler';
import { buildChatClassroomBook, saveClassroomBook } from '@/lib/server/classroom-book-service';
const log = createLogger('Chat API');

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

const SESSION_OWNERSHIP_CACHE_TTL_MS = 5 * 60 * 1000;
const SESSION_OWNERSHIP_CACHE_MAX_SIZE = 5000;
const verifiedSessionOwnershipCache = new Map<string, number>();

function buildOwnershipCacheKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`;
}

function hasValidCachedOwnership(userId: string, sessionId: string): boolean {
  const key = buildOwnershipCacheKey(userId, sessionId);
  const expiry = verifiedSessionOwnershipCache.get(key);
  if (!expiry) return false;
  if (expiry <= Date.now()) {
    verifiedSessionOwnershipCache.delete(key);
    return false;
  }
  return true;
}

function cacheSessionOwnership(userId: string, sessionId: string): void {
  if (verifiedSessionOwnershipCache.size >= SESSION_OWNERSHIP_CACHE_MAX_SIZE) {
    const now = Date.now();
    for (const [key, expiry] of verifiedSessionOwnershipCache) {
      if (expiry <= now) {
        verifiedSessionOwnershipCache.delete(key);
      }
    }

    while (verifiedSessionOwnershipCache.size >= SESSION_OWNERSHIP_CACHE_MAX_SIZE) {
      const oldestKey = verifiedSessionOwnershipCache.keys().next().value;
      if (!oldestKey) break;
      verifiedSessionOwnershipCache.delete(oldestKey);
    }
  }

  verifiedSessionOwnershipCache.set(
    buildOwnershipCacheKey(userId, sessionId),
    Date.now() + SESSION_OWNERSHIP_CACHE_TTL_MS,
  );
}

async function resolveOwnedPersistenceSessionId(params: {
  userId: string;
  requestedSessionId?: string;
}): Promise<string | undefined> {
  const requested = params.requestedSessionId?.trim();
  if (!requested) return undefined;

  if (hasValidCachedOwnership(params.userId, requested)) {
    return requested;
  }

  try {
    const sessions = await listGatewayAISessions({
      userId: params.userId,
      limit: 200,
    });
    const owned = sessions.some((session) => session.session_id === requested);
    if (!owned) {
      log.warn(
        `Ignoring unowned AI session id from client: ${requested} for user ${params.userId}`,
      );
      return undefined;
    }

    cacheSessionOwnership(params.userId, requested);
    return requested;
  } catch (error) {
    log.warn('Failed to verify AI session ownership, falling back to create new session:', error);
    return undefined;
  }
}

function extractTextFromMessage(message: unknown): string {
  if (!message || typeof message !== 'object') return '';

  const maybeContent = (message as { content?: unknown }).content;
  if (typeof maybeContent === 'string' && maybeContent.trim()) {
    return maybeContent.trim();
  }

  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return '';

  const text = parts
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const t = (part as { text?: unknown }).text;
      return typeof t === 'string' ? t : '';
    })
    .join('')
    .trim();

  return text;
}

function extractLatestUserMessage(messages: unknown): { messageId: string; content: string } | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    if (role !== 'user') continue;
    const content = extractTextFromMessage(item);
    if (!content) continue;

    const rawId = (item as { id?: unknown }).id;
    const messageId =
      typeof rawId === 'string' && rawId.trim() ? rawId.trim() : `fallback-user-${i}`;
    return { messageId, content };
  }
  return null;
}

function countUserMessages(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  let count = 0;
  for (const item of messages) {
    if (!item || typeof item !== 'object') continue;
    if ((item as { role?: unknown }).role === 'user') {
      const content = extractTextFromMessage(item);
      if (content) count += 1;
    }
  }
  return count;
}

function buildConversationContext(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;

  const lines = messages
    .slice(-8)
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const role = (item as { role?: unknown }).role;
      if (role !== 'user' && role !== 'assistant') return '';
      const content = extractTextFromMessage(item);
      if (!content) return '';
      return `${role === 'user' ? '用户' : 'AI导师'}：${content}`;
    })
    .filter(Boolean);

  return lines.length ? lines.join('\n') : undefined;
}

function resolveChatSource(source?: string): 'classroom' | 'chat' {
  const text = source?.trim().toLowerCase() || '';
  return text.includes('课堂') || text.includes('classroom') ? 'classroom' : 'chat';
}

function extractStageTitle(stage: unknown): string | undefined {
  if (!stage || typeof stage !== 'object') return undefined;
  const name = (stage as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

type ChatCapability = NonNullable<StatelessChatRequest['capability']>;

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return items.length ? items : undefined;
}

function buildSelectedCapabilityPayload(params: {
  capability: ChatCapability;
  body: StatelessChatRequest;
  latestUserText: string;
  languageModel: unknown;
  learningContext?: LearningContext;
}) {
  const { capability, body, latestUserText, languageModel, learningContext } = params;
  const toolConfig = body.config?.tutorToolConfig as Record<string, unknown> | undefined;
  const knowledgeBases = asStringArray(toolConfig?.knowledgeBases);

  if (capability === 'chat') {
    return {
      chatRequest: {
        ...body,
        ...(learningContext ? { learningContext } : {}),
      },
      languageModel,
      thinkingConfig: { enabled: false } satisfies ThinkingConfig,
      useAgenticPipeline: body.config?.useAgenticPipeline ?? false,
    };
  }

  if (capability === 'deep_solve') {
    return {
      message: latestUserText,
      enabledTools: ['rag', 'web_search', 'code_execution', 'reason'],
      knowledgeBases,
      detailedAnswer: true,
      languageModel,
      conversationContext: buildConversationContext(body.messages),
    };
  }

  if (capability === 'quiz') {
    return {
      topic: latestUserText,
      count: typeof toolConfig?.quizCount === 'number' ? toolConfig.quizCount : 5,
      questionType: typeof toolConfig?.questionType === 'string' ? toolConfig.questionType : 'choice',
      difficulty: typeof toolConfig?.difficulty === 'string' ? toolConfig.difficulty : 'auto',
      knowledgeBases,
      languageModel,
    };
  }

  if (capability === 'research') {
    return {
      topic: latestUserText,
      sources: ['web', 'papers', 'kb'],
      depth: typeof toolConfig?.researchDepth === 'string' ? toolConfig.researchDepth : 'medium',
      knowledgeBases,
      languageModel,
    };
  }

  if (capability === 'math_animator') {
    return {
      concept: latestUserText,
      outputFormat: typeof toolConfig?.outputFormat === 'string' ? toolConfig.outputFormat : 'storyboard',
      duration: typeof toolConfig?.duration === 'number' ? toolConfig.duration : 60,
      style: typeof toolConfig?.style === 'string' ? toolConfig.style : 'default',
      languageModel,
    };
  }

  return {
    description: latestUserText,
    format: typeof toolConfig?.format === 'string' ? toolConfig.format : 'svg',
    languageModel,
    size: typeof toolConfig?.size === 'object' ? toolConfig.size : undefined,
  };
}

function formatCapabilityOutput(output: Record<string, unknown> | undefined): string {
  if (!output) return '';

  const response = output.response;
  if (typeof response === 'string' && response.trim()) return response.trim();

  const assistantText = output.assistantText;
  if (typeof assistantText === 'string' && assistantText.trim()) return assistantText.trim();

  const questions = output.questions;
  if (Array.isArray(questions) && questions.length > 0) {
    return questions
      .map((item, index) => {
        if (!item || typeof item !== 'object') return '';
        const question = item as Record<string, unknown>;
        const title = typeof question.question === 'string' ? question.question : `练习题 ${index + 1}`;
        const options = Array.isArray(question.options)
          ? `\n${question.options
              .filter((option): option is string => typeof option === 'string')
              .map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`)
              .join('\n')}`
          : '';
        const answer = typeof question.answer === 'string' ? `\n\n答案：${question.answer}` : '';
        const explanation = typeof question.explanation === 'string' ? `\n解析：${question.explanation}` : '';
        return `### ${index + 1}. ${title}${options}${answer}${explanation}`;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  return '';
}

/**
 * POST /api/chat
 * Send a message and receive SSE stream of generation events
 *
 * Request body: StatelessChatRequest
 * {
 *   messages: UIMessage[],
 *   storeState: { stage, scenes, currentSceneId, mode },
 *   config: { agentIds, sessionType? },
 *   apiKey: string,
 *   baseUrl?: string,
 *   model?: string
 * }
 *
 * Response: SSE stream of StatelessEvent
 */
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  let chatModel: string | undefined;
  let chatMessageCount: number | undefined;

  try {
    const body: StatelessChatRequest = await req.json();
    chatModel = body.model;
    chatMessageCount = body.messages?.length;

    // Validate required fields
    if (!body.messages || !Array.isArray(body.messages)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: messages');
    }

    if (!body.storeState) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: storeState');
    }

    if (!body.config || !body.config.agentIds || body.config.agentIds.length === 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: config.agentIds');
    }

    const { model: languageModel, apiKey: resolvedApiKey } = resolveModel({
      modelString: body.model,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      providerType: body.providerType,
      requiresApiKey: body.requiresApiKey,
    });

    if (!resolvedApiKey && body.requiresApiKey !== false) {
      return apiError('MISSING_API_KEY', 401, 'API Key is required');
    }

    log.info('Processing request');
    log.info(
      `Agents: ${body.config.agentIds.join(', ')}, Messages: ${body.messages.length}, Turn: ${body.directorState?.turnCount ?? 0}`,
    );

    let persistenceSessionId: string | undefined;
    let persistenceUserId = '';
    if (body.persistence?.enabled) {
      try {
        const authUser = await getAuthenticatedUserFromRequest(req);
        persistenceUserId = authUser?.id?.trim() || '';
      } catch (error) {
        log.warn('Failed to resolve authenticated user for persistence, skip persistence:', error);
      }
    }
    const latestUserMessage = extractLatestUserMessage(body.messages);
    const userMessageCount = countUserMessages(body.messages);
    const shouldPersistLatestUserMessage =
      !!latestUserMessage &&
      body.persistence?.latestUserMessageId === latestUserMessage.messageId;
    let latestPersistedUserMessageId: string | undefined;

    if (body.persistence?.enabled && persistenceUserId) {
      try {
        persistenceSessionId = await resolveOwnedPersistenceSessionId({
          userId: persistenceUserId,
          requestedSessionId: body.persistence.sessionId,
        });
        if (!persistenceSessionId) {
          const created = await createGatewayAISession({
            userId: persistenceUserId,
            title: (body.persistence.title || '课堂对话').trim() || '课堂对话',
            source: body.persistence.source || '课堂互动',
            subject: body.persistence.subject,
            linkedClassroomId: body.persistence.linkedClassroomId,
            linkedConversationId: body.persistence.linkedConversationId,
          });
          persistenceSessionId = created.session_id;
        }

        if (shouldPersistLatestUserMessage) {
          const persistedUserMessage = await createGatewayAIMessage({
            sessionId: persistenceSessionId,
            role: 'user',
            userId: persistenceUserId,
            content: latestUserMessage.content,
            contentType: 'text',
            requestId: `chat-user-${persistenceSessionId}-${latestUserMessage.messageId}`,
          });
          latestPersistedUserMessageId = persistedUserMessage.message_id;
        }
      } catch (error) {
        log.warn('Chat persistence setup failed, continue without persistence:', error);
      }
    } else if (body.persistence?.enabled) {
      log.warn('Persistence requested without authenticated user, skip persistence for this request');
    }

    let learningContext = body.learningContext;
    if (persistenceUserId) {
      learningContext = await buildLearningContext({
        userId: persistenceUserId,
        source: resolveChatSource(body.persistence?.source),
        classroomId: body.persistence?.linkedClassroomId || body.storeState.stage?.id || null,
        sceneId: body.storeState.currentSceneId,
        aiSessionId: persistenceSessionId || body.persistence?.sessionId || null,
        topic: latestUserMessage?.content || body.config.discussionTopic || extractStageTitle(body.storeState.stage),
        language: body.storeState.stage?.language || 'zh-CN',
        extra: {
          agentIds: body.config.agentIds,
          mode: body.storeState.mode,
          turnCount: body.directorState?.turnCount ?? 0,
          userMessageCount,
        },
        enabledTools: [
          { id: 'whiteboard', enabled: true, config: {} },
          { id: 'multi_agent_tutoring', enabled: body.config.agentIds.length > 1, config: {} },
          { id: 'learning_record_extraction', enabled: Boolean(persistenceSessionId), config: {} },
        ],
        lookbackDays: 14,
      });
    }

    // Use the native request signal for abort propagation
    const signal = req.signal;

    // Create SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Stream generation in background with heartbeat to prevent connection timeout
    const HEARTBEAT_INTERVAL_MS = 15_000;
    const requestId = `chat-${persistenceUserId || 'anon'}-${Date.now()}`;

    (async () => {
      // Heartbeat: periodically send SSE comments to keep the connection alive.
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const startHeartbeat = () => {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          try {
            writer.write(encoder.encode(`:heartbeat\n\n`)).catch(() => stopHeartbeat());
          } catch {
            stopHeartbeat();
          }
        }, HEARTBEAT_INTERVAL_MS);
      };
      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      function emitStageEvent(stage: string, status: 'running' | 'success' | 'error', extra?: Record<string, unknown>) {
        const event = {
          type: 'capability_stage' as const,
          data: { stage, status, requestId, ...extra },
        };
        writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => {});
      }

      try {
        startHeartbeat();

        // Build capability runtime with registered chat handler
        const runtime = createDefaultRuntime({
          buildContext: async () => learningContext || createLearningContext(persistenceUserId || 'anonymous'),
          checkGuard: async () => ({ passed: true }),
          emitTrace: async (event) => {
            globalStreamBus.publish(event);
          },
          persistResult: async (result) => {
            const output = result.output as Record<string, unknown> | undefined;
            const assistantText = typeof output?.assistantText === 'string' ? output.assistantText : '';
            const wasAborted = Boolean(output?.wasAborted);
            const cueUserReceived = Boolean(output?.cueUserReceived);
            const totalAgents = typeof output?.totalAgents === 'number' ? output.totalAgents : 0;

            if (!wasAborted && persistenceSessionId && assistantText.trim()) {
              try {
                await createGatewayAIMessage({
                  sessionId: persistenceSessionId,
                  role: 'assistant',
                  userId: persistenceUserId,
                  content: assistantText.trim(),
                  contentType: 'text',
                  modelName: body.model,
                  requestId: `chat-assistant-${persistenceSessionId}-${latestUserMessage?.messageId || 'none'}-turn-${body.directorState?.turnCount ?? 0}`,
                });
              } catch (error) {
                log.warn('Failed to persist assistant response after stream:', error);
              }
            }

            const shouldTriggerExtract =
              !wasAborted &&
              (cueUserReceived || totalAgents === 0);

            if (shouldTriggerExtract && persistenceSessionId) {
              void createLearningRecordExtractJob({
                sessionId: persistenceSessionId,
                userId: persistenceUserId || undefined,
                latestUserMessageId: latestPersistedUserMessageId,
                messageCount: userMessageCount,
              }).catch((error) => {
                log.warn('Failed to enqueue learning record extract job:', error);
              });
            }

            // Persist ClassroomBook artifact for this chat turn
            if (!wasAborted && assistantText.trim() && persistenceUserId) {
              try {
                const knowledgePointIds =
                  (result.stages.find((s) => s.stage === 'post_process')?.output?.knowledgePointIds as string[] | undefined) || [];
                const book = buildChatClassroomBook({
                  userId: persistenceUserId,
                  sessionId: persistenceSessionId || requestId,
                  requestId: requestId,
                  assistantText: assistantText.trim(),
                  topic: learningContext?.metadata?.topic,
                  sourceCapability: 'ai_tutor_chat',
                  knowledgePointIds,
                });
                await saveClassroomBook(book);
                log.info(`Persisted ClassroomBook ${book.id} for chat turn`);
              } catch (error) {
                log.warn('Failed to persist ClassroomBook artifact:', error);
              }
            }
          },
        });
        
        // v3.3+: 根据请求的 capability 选择对应的处理器
        const requestedCapability = body.capability ?? 'chat';
        
        // 映射 capability 到 capabilityId 和处理器
        type CapabilityType = NonNullable<typeof requestedCapability>;
        const capabilityHandlers: Record<CapabilityType, { capabilityId: RuntimeCapabilityId; handler: CapabilityHandler<never> }> = {
          chat: { capabilityId: 'ai_tutor_chat', handler: aiTutorChatHandler as unknown as CapabilityHandler<never> },
          deep_solve: { capabilityId: 'deep_solve', handler: deepSolveHandler as unknown as CapabilityHandler<never> },
          quiz: { capabilityId: 'quiz_practice', handler: quizPracticeHandler as unknown as CapabilityHandler<never> },
          research: { capabilityId: 'deep_research', handler: deepResearchHandler as unknown as CapabilityHandler<never> },
          math_animator: { capabilityId: 'math_animator', handler: mathAnimatorHandler as unknown as CapabilityHandler<never> },
          visualize: { capabilityId: 'visualize', handler: visualizeHandler as unknown as CapabilityHandler<never> },
        };
        
        const selectedCapability = capabilityHandlers[requestedCapability as CapabilityType];
        if (!selectedCapability) {
          const errorEvent: StatelessEvent = {
            type: 'error',
            data: {
              message: `Unsupported capability: ${requestedCapability}`,
            },
          };
          stopHeartbeat();
          await writer.write(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
          await writer.close();
          return;
        }
        
        // 注册对应的处理器
        runtime.registerHandler(selectedCapability.handler);
        
        log.info(`Using capability: ${requestedCapability} (capabilityId: ${selectedCapability.capabilityId})`);

        const selectedPayload = buildSelectedCapabilityPayload({
          capability: requestedCapability as ChatCapability,
          body: {
            ...body,
            apiKey: resolvedApiKey,
          },
          latestUserText: latestUserMessage?.content || '',
          languageModel,
          learningContext,
        });

        const capabilityRequest = {
          requestId,
          capabilityId: selectedCapability.capabilityId, // v3.3+: 动态选择 capabilityId
          userId: persistenceUserId || 'anonymous',
          payload: selectedPayload,
          streaming: true,
          signal,
          learningContext,
        };

        // Run through CapabilityRuntime — stages (context_build, guard_check, agent_invoke, persist, complete)
        // are emitted by the runtime; agent_stream stages carry real-time agent events.
        const assistantMessageId = `assistant-${requestId}`;
        let assistantMessageStarted = false;
        let emittedVisibleText = false;
        const structuredResultOnly =
          requestedCapability === 'math_animator'
          || requestedCapability === 'visualize'
          || requestedCapability === 'quiz';

        const writeEvent = async (event: StatelessEvent) => {
          await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        const writeRawEvent = async (event: Record<string, unknown>) => {
          await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        const ensureAssistantMessageStarted = async () => {
          if (assistantMessageStarted) return;
          assistantMessageStarted = true;
          await writeEvent({
            type: 'agent_start',
            data: {
              messageId: assistantMessageId,
              agentId: String(requestedCapability),
              agentName: 'AI导师',
            },
          });
        };

        for await (const stageResult of runtime.run(capabilityRequest)) {
          if (stageResult.stage === 'agent_stream') {
            if (structuredResultOnly) {
              continue;
            }

            const rawAgentEvent = stageResult.output?.agentEvent as {
              type?: string;
              data?: Record<string, unknown>;
            } | undefined;
            let agentEvent = rawAgentEvent as StatelessEvent | undefined;
            if (rawAgentEvent?.type && agentEvent) {
              if (rawAgentEvent.type === 'text_delta') {
                const content = rawAgentEvent.data?.content;
                if (typeof content === 'string' && content) {
                  emittedVisibleText = true;
                  await ensureAssistantMessageStarted();
                  const rawMessageId = rawAgentEvent.data?.messageId;
                  agentEvent = {
                    type: 'text_delta',
                    data: {
                      content,
                      messageId: typeof rawMessageId === 'string' ? rawMessageId : assistantMessageId,
                    },
                  };
                }
              } else if (rawAgentEvent.type === 'code_delta') {
                const code = rawAgentEvent.data?.code;
                if (typeof code === 'string' && code) {
                  emittedVisibleText = true;
                  await ensureAssistantMessageStarted();
                  agentEvent = {
                    type: 'text_delta',
                    data: { content: code, messageId: assistantMessageId },
                  };
                }
              } else if (rawAgentEvent.type === 'tool_start' || rawAgentEvent.type === 'tool_end') {
                // 工具事件也需要先创建消息
                await ensureAssistantMessageStarted();
              }
              if (agentEvent) {
                await writeEvent(agentEvent);
              }
            }
          } else {
            emitStageEvent(
              stageResult.stage,
              stageResult.success ? 'success' : 'error',
              stageResult.output,
            );

            if (stageResult.stage === 'complete') {
              if (structuredResultOnly) {
                await writeRawEvent({
                  type: 'result',
                  data: {
                    capabilityId: selectedCapability.capabilityId,
                    output: stageResult.output,
                  },
                });
                emittedVisibleText = true;
                continue;
              }

              const finalText = formatCapabilityOutput(stageResult.output);
              if (!emittedVisibleText && finalText) {
                await ensureAssistantMessageStarted();
                await writeEvent({
                  type: 'text_delta',
                  data: { content: finalText, messageId: assistantMessageId },
                });
                emittedVisibleText = true;
              }
            }
          }
        }

        if (assistantMessageStarted) {
          await writeEvent({
            type: 'agent_end',
            data: { messageId: assistantMessageId, agentId: String(requestedCapability) },
          });
          await writeEvent({
            type: 'done',
            data: {
              totalActions: 0,
              totalAgents: 1,
              agentHadContent: emittedVisibleText,
            },
          });
        }

        stopHeartbeat();
        await writer.close();
      } catch (error) {
        stopHeartbeat();

        // If aborted, just close the writer silently
        if (signal.aborted) {
          log.info('Request aborted during streaming');
          try {
            await writer.close();
          } catch {
            /* already closed */
          }
          return;
        }

        log.error(
          `Chat stream error [model=${body.model ?? 'unknown'}, agents=${body.config?.agentIds?.length ?? 0}, messages=${body.messages?.length ?? 0}]:`,
          error,
        );

        // Try to send error event
        try {
          const errorEvent: StatelessEvent = {
            type: 'error',
            data: {
              message: '聊天生成失败，请稍后重试。',
            },
          };
          await writer.write(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
          await writer.close();
        } catch {
          // Writer may already be closed
        }
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...(persistenceSessionId ? { 'x-ai-session-id': persistenceSessionId } : {}),
      },
    });
  } catch (error) {
    log.error(
      `Chat request failed [model=${chatModel ?? 'unknown'}, messages=${chatMessageCount ?? 0}]:`,
      error,
    );
    return apiError('INTERNAL_ERROR', 500, 'Failed to process request');
  }
}
