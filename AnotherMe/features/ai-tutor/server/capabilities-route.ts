/**
 * Capabilities API Endpoint
 *
 * POST /api/capabilities/[capabilityId]
 *
 * 统一的能力执行入口，支持流式SSE响应
 */

import { NextRequest } from 'next/server';
import { createDefaultRuntime } from '../orchestration/capability-runtime';
import type { CapabilityHandler } from '../orchestration/capability-runtime';
import type { CapabilityId } from '../orchestration/capability-registry';
import { aiTutorChatHandler } from '../orchestration/handlers/chat-handler';
import { classroomGenerateHandler } from '../orchestration/handlers/classroom-generation-handler';
import { deepSolveHandler } from '../orchestration/handlers/deep-solve-handler';
import { deepResearchHandler } from '../orchestration/handlers/deep-research-handler';
import { mathAnimatorHandler } from '../orchestration/handlers/math-animator-handler';
import { problemVideoGenerateHandler } from '../orchestration/handlers/problem-video-handler';
import { quizPracticeHandler } from '../orchestration/handlers/quiz-practice-handler';
import { visualizeHandler } from '../orchestration/handlers/visualize-handler';
import { resolveModel } from '@/lib/server/resolve-model';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/session';
import { createLearningContext } from '@/lib/types/learning-context';
import { createLogger } from '@/lib/logger';

const log = createLogger('CapabilitiesAPI');

// 注册所有能力处理器
const handlers = new Map<CapabilityId, CapabilityHandler<never>>([
  ['ai_tutor_chat', aiTutorChatHandler as unknown as CapabilityHandler<never>],
  ['course_generate', classroomGenerateHandler as unknown as CapabilityHandler<never>],
  ['problem_video_generate', problemVideoGenerateHandler as unknown as CapabilityHandler<never>],
  ['deep_solve', deepSolveHandler as unknown as CapabilityHandler<never>],
  ['deep_research', deepResearchHandler as unknown as CapabilityHandler<never>],
  ['math_animator', mathAnimatorHandler as unknown as CapabilityHandler<never>],
  ['visualize', visualizeHandler as unknown as CapabilityHandler<never>],
  ['quiz_practice', quizPracticeHandler as unknown as CapabilityHandler<never>],
]);

// 支持的能力列表
const SUPPORTED_CAPABILITIES = [
  {
    id: 'ai_tutor_chat',
    name: 'AI导师对话',
    description: '与AI导师进行个性化对话学习',
    category: 'chat',
  },
  {
    id: 'course_generate',
    name: '课程生成',
    description: '根据学习主题自动生成结构化课程',
    category: 'generation',
  },
  {
    id: 'problem_video_generate',
    name: '题目视频生成',
    description: '上传题目图片生成讲解视频',
    category: 'generation',
  },
  {
    id: 'deep_solve',
    name: '深度解题',
    description: '多阶段深度解题：分析->推理->解答',
    category: 'chat',
  },
  {
    id: 'deep_research',
    name: '深度研究',
    description: '多源搜索与深度研究报告生成',
    category: 'generation',
  },
  {
    id: 'math_animator',
    name: '数学动画',
    description: '生成数学概念动画或分镜脚本',
    category: 'visualization',
  },
  {
    id: 'visualize',
    name: '可视化',
    description: '生成SVG、Chart.js、Mermaid图表',
    category: 'visualization',
  },
  {
    id: 'quiz_practice',
    name: '测验练习',
    description: '生成结构化练习题和答案解析',
    category: 'practice',
  },
];

function isSupportedCapabilityId(id: string): id is CapabilityId {
  return handlers.has(id as CapabilityId);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return items.length ? items : undefined;
}

function normalizeCapabilityPayload(
  capabilityId: CapabilityId,
  body: Record<string, unknown>,
  languageModel: unknown,
): Record<string, unknown> {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const knowledgeBases = asStringArray(body.knowledgeBases);
  const base = { ...body, languageModel };

  switch (capabilityId) {
    case 'deep_solve':
      return {
        ...base,
        message,
        enabledTools: Array.isArray(body.enabledTools)
          ? body.enabledTools
          : ['rag', 'web_search', 'code_execution', 'reason'],
        knowledgeBases,
      };
    case 'deep_research':
      return {
        ...base,
        topic: typeof body.topic === 'string' && body.topic.trim() ? body.topic.trim() : message,
        sources: Array.isArray(body.sources) ? body.sources : ['web', 'papers', 'kb'],
        depth: typeof body.depth === 'string' ? body.depth : 'medium',
        knowledgeBases,
      };
    case 'math_animator':
      return {
        ...base,
        concept: typeof body.concept === 'string' && body.concept.trim() ? body.concept.trim() : message,
        outputFormat: typeof body.outputFormat === 'string' ? body.outputFormat : 'video',
        duration: typeof body.duration === 'number' ? body.duration : 60,
        style: typeof body.style === 'string' ? body.style : 'default',
      };
    case 'visualize':
      return {
        ...base,
        description: typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : message,
        format: typeof body.format === 'string' ? body.format : 'svg',
      };
    case 'quiz_practice':
      return {
        ...base,
        topic: typeof body.topic === 'string' && body.topic.trim() ? body.topic.trim() : message,
        count: typeof body.count === 'number' ? body.count : 5,
        questionType: typeof body.questionType === 'string' ? body.questionType : 'choice',
        difficulty: typeof body.difficulty === 'string' ? body.difficulty : 'auto',
        knowledgeBases,
      };
    default:
      return base;
  }
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

function shouldRenderStructuredResultOnly(capabilityId: CapabilityId): boolean {
  return capabilityId === 'math_animator' || capabilityId === 'visualize' || capabilityId === 'quiz_practice';
}

export async function GET() {
  return Response.json({
    capabilities: SUPPORTED_CAPABILITIES,
  });
}

interface Params {
  params: Promise<{ capabilityId: string }>;
}

export async function POST(req: NextRequest, context: Params) {
  const { capabilityId: rawCapabilityId } = await context.params;
  if (!isSupportedCapabilityId(rawCapabilityId)) {
    return Response.json(
      { error: 'Capability not found', supportedCapabilities: SUPPORTED_CAPABILITIES.map((c) => c.id) },
      { status: 404 },
    );
  }

  const capabilityId = rawCapabilityId;
  const handler = handlers.get(capabilityId);

  if (!handler) {
    return Response.json(
      { error: 'Capability not found', supportedCapabilities: SUPPORTED_CAPABILITIES.map((c) => c.id) },
      { status: 404 }
    );
  }

  try {
    const body = await req.json();

    // 解析用户
    let userId = 'anonymous';
    try {
      const authUser = await getAuthenticatedUserFromRequest(req);
      if (authUser?.id) {
        userId = authUser.id;
      }
    } catch {
      // Continue with anonymous user
    }

    // 解析模型
    const { model: languageModel, apiKey: resolvedApiKey } = resolveModel({
      modelString: body.model,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      providerType: body.providerType,
      requiresApiKey: body.requiresApiKey,
    });

    if (!resolvedApiKey && body.requiresApiKey !== false) {
      return Response.json({ error: 'API Key is required' }, { status: 401 });
    }

    // 注入 languageModel，并把通用 message 字段适配成各 capability handler 需要的字段。
    const payload = normalizeCapabilityPayload(
      capabilityId,
      body as Record<string, unknown>,
      languageModel,
    );

    // 创建SSE流
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // 心跳间隔
    const HEARTBEAT_INTERVAL_MS = 15_000;

    (async () => {
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

      try {
        startHeartbeat();

        const runtime = createDefaultRuntime({
          buildContext: async ({ payload }) => createLearningContext(userId, {
            metadata: {
              source: 'chat',
              topic: typeof payload.topic === 'string'
                ? payload.topic
                : typeof payload.message === 'string'
                  ? payload.message
                  : null,
              language: 'zh-CN',
              grade: null,
              extra: { capabilityId },
            },
          }),
          checkGuard: async () => ({ passed: true }),
          emitTrace: async () => {},
          persistResult: async () => {},
        });

        runtime.registerHandler(handler);

        const request = {
          requestId: `${capabilityId}-${userId}-${Date.now()}`,
          capabilityId,
          userId,
          payload,
          streaming: true,
          signal: req.signal,
        };

        let emittedVisibleText = false;

        const writeEvent = async (event: Record<string, unknown>) => {
          await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        for await (const stageResult of runtime.run(request)) {
          if (req.signal.aborted) {
            break;
          }

          if (stageResult.stage === 'agent_stream') {
            if (shouldRenderStructuredResultOnly(capabilityId)) {
              continue;
            }

            const agentEvent = stageResult.output?.agentEvent as
              | { type?: string; data?: Record<string, unknown> }
              | undefined;

            if (!agentEvent?.type) continue;

            if (agentEvent.type === 'text_delta') {
              const content = agentEvent.data?.content;
              if (typeof content === 'string' && content) {
                emittedVisibleText = true;
              }
            } else if (agentEvent.type === 'code_delta') {
              const code = agentEvent.data?.code;
              if (typeof code === 'string' && code) {
                emittedVisibleText = true;
              }
            }

            await writeEvent(agentEvent as unknown as Record<string, unknown>);
            continue;
          }

          if (stageResult.stage === 'complete') {
            await writeEvent({
              type: 'result',
              data: {
                capabilityId,
                output: stageResult.output,
              },
            });

            if (shouldRenderStructuredResultOnly(capabilityId)) {
              emittedVisibleText = true;
              continue;
            }

            const finalText = formatCapabilityOutput(stageResult.output);
            if (!emittedVisibleText && finalText) {
              await writeEvent({
                type: 'text_delta',
                data: { content: finalText },
              });
              emittedVisibleText = true;
            }
          }
        }

        stopHeartbeat();
        await writer.close();
      } catch (error) {
        stopHeartbeat();

        if (req.signal.aborted) {
          log.info(`[${capabilityId}] Request aborted`);
          try {
            await writer.close();
          } catch {
            // Already closed
          }
          return;
        }

        log.error(`[${capabilityId}] Execution failed:`, error);

        try {
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            data: {
              code: 'EXECUTION_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
          })}\n\n`;
          await writer.write(encoder.encode(errorEvent));
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
      },
    });
  } catch (error) {
    log.error(`[${capabilityId}] Request parsing failed:`, error);
    return Response.json(
      { error: 'Invalid request', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}
