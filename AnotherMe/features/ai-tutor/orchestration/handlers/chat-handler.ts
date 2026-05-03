/**
 * AI Tutor Chat Capability Handler
 *
 * Wraps the stateless multi-agent chat generation as a CapabilityRuntime handler.
 * This allows chat to participate in the unified capability lifecycle:
 *   context_build -> guard_check -> pre_process -> agent_invoke -> post_process -> persist
 *
 * The handler itself does NOT handle HTTP or SSE — that remains in chat/route.ts.
 * Instead, it returns a generator that yields both capability stages and agent events.
 *
 * P2 Update: 支持两种工具调用模式
 * 1. 预执行模式（legacy）：用户勾选的工具在回答前全部并行执行
 * 2. Agentic模式（P2）：使用 thinking -> acting -> observing -> responding 四阶段 pipeline，
 *    让模型按需选择工具
 */

import type { LanguageModel } from 'ai';
import type { CapabilityHandler, CapabilityRequest, CapabilityStageResult, CapabilityResult } from '../capability-runtime';
import type { StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import type { ThinkingConfig } from '@/lib/types/provider';
import { statelessGenerate } from '@/lib/orchestration/stateless-generate';
import { globalStreamBus } from '../stream-bus';
import { createTraceEvent } from '@/lib/types/teaching-trace';
import { createLogger } from '@/lib/logger';
import { formatToolResultsForPrompt } from '../tutor-tools/registry';
import type { ToolExecutionContext } from '../tutor-tools/types';
import { runAgenticPipeline, type AgenticPipelineEvent, type ToolTrace } from '../agentic-pipeline';
import { runWithToolContext } from '../tutor-tools/ai-sdk-tools';

const log = createLogger('ChatHandler');

export type ChatCapabilityPayload = {
  chatRequest: StatelessChatRequest;
  languageModel: LanguageModel;
  thinkingConfig?: ThinkingConfig;
  /**
   * 是否使用 agentic pipeline（P2）
   * - true: 使用 thinking -> acting -> observing -> responding 四阶段
   * - false: 预执行所有启用的工具（legacy）
   * @default false (保持向后兼容)
   */
  useAgenticPipeline?: boolean;
};

export type ChatEvent =
  | { type: 'stage'; stage: CapabilityStageResult }
  | { type: 'agent'; event: StatelessEvent };

export interface ChatCapabilityResult {
  success: boolean;
  assistantText: string;
  totalActions: number;
  totalAgents: number;
  wasAborted: boolean;
  directorState: StatelessChatRequest['directorState'];
  error?: string;
  /**
   * P2: Agentic pipeline 的额外输出
   */
  agenticMeta?: {
    thinking?: string;
    observation?: string;
    toolTraces: ToolTrace[];
  };
}

/**
 * 核心消息类型（简化版）
 */
type CoreMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

/**
 * 将 UIMessage 转换为 CoreMessage 格式
 */
function convertToCoreMessages(messages: StatelessChatRequest['messages']): CoreMessage[] {
  return messages.map((msg): CoreMessage => {
    // 从 parts 中提取文本内容
    const textContent = msg.parts
      ?.filter((part) => part.type === 'text')
      .map((part) => (part as { text?: string }).text)
      .filter((text): text is string => typeof text === 'string')
      .join('') || '';

    return {
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: textContent,
    };
  });
}

/**
 * 提取用户消息的文本内容
 */
function extractUserMessageText(chatRequest: StatelessChatRequest): string {
  const lastUserMessage = chatRequest.messages
    .filter((m) => m.role === 'user')
    .pop();

  return lastUserMessage?.parts
    ?.filter((part) => part.type === 'text')
    .map((part) => (part as { text?: string }).text)
    .filter(Boolean)
    .join('') || '';
}

/**
 * 构建工具执行上下文
 */
function buildToolContext(
  chatRequest: StatelessChatRequest,
  languageModel: LanguageModel
): ToolExecutionContext {
  return {
    message: extractUserMessageText(chatRequest),
    config: {
      ...chatRequest.config?.tutorToolConfig,
      userId: chatRequest.persistence?.userId,
    },
    stage: chatRequest.storeState?.stage,
    scenes: chatRequest.storeState?.scenes || [],
    apiKey: chatRequest.apiKey || '',
    baseUrl: chatRequest.baseUrl,
    model: chatRequest.model,
    languageModel,
  };
}

export const aiTutorChatHandler: CapabilityHandler<ChatCapabilityPayload> = {
  capabilityId: 'ai_tutor_chat',

  validatePayload(payload: unknown): ChatCapabilityPayload {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload: expected object');
    }
    const p = payload as Record<string, unknown>;
    if (!p.chatRequest || typeof p.chatRequest !== 'object') {
      throw new Error('Invalid payload: chatRequest required');
    }
    if (!p.languageModel || typeof p.languageModel !== 'object') {
      throw new Error('Invalid payload: languageModel required');
    }
    return {
      chatRequest: p.chatRequest as StatelessChatRequest,
      languageModel: p.languageModel as LanguageModel,
      thinkingConfig: p.thinkingConfig as ThinkingConfig | undefined,
      useAgenticPipeline: p.useAgenticPipeline as boolean | undefined,
    };
  },

  async *execute(request: CapabilityRequest<ChatCapabilityPayload>): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
    const startTime = Date.now();
    const { chatRequest, useAgenticPipeline } = request.payload;

    const enabledTools = chatRequest.config?.enabledTutorTools || [];

    // ============================================================
    // P2: Agentic Pipeline Mode
    // ============================================================
    if (useAgenticPipeline && enabledTools.length > 0) {
      log.info('[ChatHandler] Using Agentic Pipeline mode', { enabledTools });
      return yield* executeAgenticPipeline(request, startTime);
    }

    // ============================================================
    // Legacy: Pre-execute all tools mode
    // ============================================================
    log.info('[ChatHandler] Using legacy pre-execute mode', { enabledTools });
    return yield* executeLegacyPipeline(request, startTime);
  },
};

/**
 * P2: Agentic Pipeline 执行流程
 * thinking -> acting -> observing -> responding
 */
async function* executeAgenticPipeline(
  request: CapabilityRequest<ChatCapabilityPayload>,
  startTime: number
): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
  const { chatRequest, languageModel, thinkingConfig } = request.payload;
  const signal = request.signal;
  const enabledTools = chatRequest.config?.enabledTutorTools || [];

  // Stage: pre_process (在 agentic 模式下主要是准备上下文)
  const preStart = Date.now();
  const toolContext = buildToolContext(chatRequest, languageModel);

  yield {
    stage: 'pre_process',
    success: true,
    durationMs: Date.now() - preStart,
    completedAt: Date.now(),
  };

  // Stage: agent_invoke (使用 agentic pipeline)
  const invokeStart = Date.now();
  let assistantText = '';
  let wasAborted = false;
  const toolTraces: ToolTrace[] = [];
  let thinking = '';
  let observation = '';
  const messageId = `agentic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const pipelineOptions = {
      userMessage: extractUserMessageText(chatRequest),
      conversationHistory: convertToCoreMessages(chatRequest.messages.slice(0, -1)),
      enabledTools,
      toolContext,
      languageModel,
      thinkingConfig,
      signal,
    };

    // 使用 AsyncLocalStorage 包装工具上下文
    const pipelineGenerator = runWithToolContext(
      {
        context: toolContext,
        onToolStart: (name, args) => {
          log.info(`[AgenticPipeline] Tool started: ${name}`, args);
        },
        onToolEnd: (name, result) => {
          log.info(`[AgenticPipeline] Tool completed: ${name}`, { success: result.success });
        },
      },
      () => runAgenticPipeline(pipelineOptions)
    );

    for await (const event of pipelineGenerator) {
      if (signal?.aborted) {
        wasAborted = true;
        break;
      }

      // 转发 agentic pipeline 事件为 agent_stream 阶段
      yield* handleAgenticEvent(event, invokeStart, messageId);

      // 收集最终结果
      if (event.type === 'thinking_end' && event.data && typeof event.data === 'object' && 'thinking' in event.data) {
        thinking = (event.data as { thinking: string }).thinking;
      }
      if (event.type === 'observation_end' && event.data && typeof event.data === 'object' && 'observation' in event.data) {
        observation = (event.data as { observation: string }).observation;
      }
      if (event.type === 'responding_chunk' && event.data && typeof event.data === 'object' && 'chunk' in event.data) {
        assistantText += (event.data as { chunk: string }).chunk;
      }
      if (event.type === 'tool_end' && event.data) {
        const toolData = event.data as { toolName: string; toolId: string; success: boolean; output: string };
        toolTraces.push({
          id: toolData.toolId,
          name: toolData.toolName,
          arguments: {}, // 简化处理
          result: toolData.output,
          success: toolData.success,
          startTime: Date.now(),
          endTime: Date.now(),
        });
      }
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('[ChatHandler] Agentic pipeline failed', err);
    yield {
      stage: 'agent_invoke',
      success: false,
      error: { code: 'AGENTIC_PIPELINE_FAILED', message: err.message },
      durationMs: Date.now() - invokeStart,
      completedAt: Date.now(),
    };
    throw err;
  }

  yield {
    stage: 'agent_invoke',
    success: true,
    output: {
      assistantText,
      totalActions: 0,
      totalAgents: 1,
      wasAborted,
      cueUserReceived: false,
    },
    durationMs: Date.now() - invokeStart,
    completedAt: Date.now(),
  };

  // 后续阶段（post_process, persist, complete）
  return yield* finalizePipeline(request, startTime, assistantText, wasAborted, {
    totalActions: toolTraces.length,
    totalAgents: 1,
    cueUserReceived: false,
    agenticMeta: {
      thinking,
      observation,
      toolTraces,
    },
  });
}

/**
 * 处理 Agentic Pipeline 事件并转换为 CapabilityStageResult
 */
function* handleAgenticEvent(
  event: AgenticPipelineEvent,
  invokeStart: number,
  messageId: string,
): Generator<CapabilityStageResult> {
  const baseResult = {
    durationMs: Date.now() - invokeStart,
    completedAt: Date.now(),
  };

  switch (event.type) {
    case 'thinking_start':
      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'thinking',
            data: { stage: 'agent_loading' },
          },
        },
        ...baseResult,
      };
      break;

    case 'thinking_chunk':
      break;

    case 'thinking_end':
      break;

    case 'tool_start':
      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'tool_start',
            data: event.data,
          },
        },
        ...baseResult,
      };
      break;

    case 'tool_end':
      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'tool_end',
            data: event.data,
          },
        },
        ...baseResult,
      };
      break;

    case 'observation_start':
      break;

    case 'observation_chunk':
      break;

    case 'observation_end':
      break;

    case 'responding_start':
      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'agent_start',
            data: {
              messageId,
              agentId: 'ai-tutor',
              agentName: 'AI导师',
            },
          },
        },
        ...baseResult,
      };
      break;

    case 'responding_chunk':
      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'text_delta',
            data: { content: (event.data as { chunk: string }).chunk, messageId },
          },
        },
        ...baseResult,
      };
      break;

    case 'responding_end':
      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'agent_end',
            data: { messageId, agentId: 'ai-tutor' },
          },
        },
        ...baseResult,
      };
      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'done',
            data: {
              totalActions: 0,
              totalAgents: 1,
              agentHadContent: true,
            },
          },
        },
        ...baseResult,
      };
      break;

    case 'error':
      yield {
        stage: 'agent_stream',
        success: false,
        error: {
          code: 'AGENTIC_ERROR',
          message: (event.data as { error: string }).error,
        },
        ...baseResult,
      };
      break;

    case 'complete':
      // 完成事件，不需要额外输出
      break;
  }
}

/**
 * Legacy: 预执行所有工具的流程
 */
async function* executeLegacyPipeline(
  request: CapabilityRequest<ChatCapabilityPayload>,
  startTime: number
): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
  const { chatRequest, languageModel, thinkingConfig } = request.payload;
  const signal = request.signal;

  // Stage: pre_process - 执行 AI导师工具
  const preStart = Date.now();
  let toolResultsText = '';
  const enabledTools = chatRequest.config?.enabledTutorTools || [];

  try {
    if (enabledTools.length > 0) {
      log.info(`[ChatHandler] Executing tutor tools (legacy): ${enabledTools.join(', ')}`);

      const toolContext = buildToolContext(chatRequest, languageModel);

      // 并行执行所有启用的工具
      const { executeTools } = await import('../tutor-tools/registry');
      const results = await executeTools(enabledTools, toolContext);

      // 格式化工具结果为提示词附加内容
      toolResultsText = formatToolResultsForPrompt(results);

      // 发送工具执行事件到前端
      for (const [name, result] of results) {
        const toolId = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        yield {
          stage: 'agent_stream',
          success: true,
          output: {
            agentEvent: {
              type: 'tool_start',
              data: { toolName: name, toolId },
            },
          },
          durationMs: Date.now() - preStart,
          completedAt: Date.now(),
        };

        yield {
          stage: 'agent_stream',
          success: true,
          output: {
            agentEvent: {
              type: 'tool_end',
              data: {
                toolName: name,
                toolId,
                success: result.success,
                output: result.output,
                error: result.error,
              },
            },
          },
          durationMs: Date.now() - preStart,
          completedAt: Date.now(),
        };

        if (result.success) {
          log.info(`[ChatHandler] Tool ${name} executed successfully`);
        } else {
          log.warn(`[ChatHandler] Tool ${name} failed: ${result.error}`);
        }
      }
    }

    yield {
      stage: 'pre_process',
      success: true,
      durationMs: Date.now() - preStart,
      completedAt: Date.now(),
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('[ChatHandler] Tool execution error:', err);
    yield {
      stage: 'pre_process',
      success: false,
      error: { code: 'PRE_PROCESS_FAILED', message: err.message },
      durationMs: Date.now() - preStart,
      completedAt: Date.now(),
    };
    throw err;
  }

  // Stage: agent_invoke (the core generation loop)
  const invokeStart = Date.now();
  let assistantText = '';
  let totalActions = 0;
  let totalAgents = 0;
  let wasAborted = false;
  let doneTotalAgents = 0;
  let cueUserReceived = false;

  try {
    const enhancedChatRequest = toolResultsText
      ? {
          ...chatRequest,
          config: {
            ...chatRequest.config,
            systemPromptAddendum: [
              chatRequest.config?.systemPromptAddendum || '',
              toolResultsText,
            ].filter(Boolean).join('\n\n'),
          },
        }
      : chatRequest;

    const generator = statelessGenerate(enhancedChatRequest, signal || new AbortController().signal, languageModel, thinkingConfig);

    for await (const event of generator) {
      if (signal?.aborted) {
        wasAborted = true;
        break;
      }

      if (event.type === 'text_delta') {
        const delta = event.data?.content;
        if (typeof delta === 'string' && delta) {
          assistantText += delta;
        }
      }
      if (event.type === 'cue_user') {
        cueUserReceived = true;
      }
      if (event.type === 'done') {
        const ta = event.data?.totalAgents;
        doneTotalAgents = typeof ta === 'number' ? ta : 0;
      }
      if (event.type === 'action') {
        totalActions++;
      }
      if (event.type === 'agent_start') {
        totalAgents++;
      }

      yield {
        stage: 'agent_stream',
        success: true,
        output: { agentEvent: event },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };

      globalStreamBus.publish(
        createTraceEvent(
          'agent_response',
          request.requestId,
          {
            eventType: event.type,
            agentId: (event.data as Record<string, unknown> | undefined)?.agentId,
          },
          { stage: 'agent_invoke' },
        ),
      );
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    yield {
      stage: 'agent_invoke',
      success: false,
      error: { code: 'AGENT_INVOKE_FAILED', message: err.message },
      durationMs: Date.now() - invokeStart,
      completedAt: Date.now(),
    };
    throw err;
  }

  yield {
    stage: 'agent_invoke',
    success: true,
    output: {
      assistantText,
      totalActions,
      totalAgents: doneTotalAgents || totalAgents,
      wasAborted,
      cueUserReceived,
    },
    durationMs: Date.now() - invokeStart,
    completedAt: Date.now(),
  };

  // 后续阶段
  return yield* finalizePipeline(request, startTime, assistantText, wasAborted, {
    totalActions,
    totalAgents: doneTotalAgents || totalAgents,
    cueUserReceived,
  });
}

/**
 * 完成 pipeline 的后续阶段
 */
async function* finalizePipeline(
  request: CapabilityRequest<ChatCapabilityPayload>,
  startTime: number,
  assistantText: string,
  wasAborted: boolean,
  options?: {
    totalActions?: number;
    totalAgents?: number;
    cueUserReceived?: boolean;
    agenticMeta?: { thinking?: string; observation?: string; toolTraces: ToolTrace[] };
  },
): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
  const { chatRequest } = request.payload;
  const totalActions = options?.totalActions ?? 0;
  const totalAgents = options?.totalAgents ?? 1;
  const cueUserReceived = options?.cueUserReceived ?? false;
  const agenticMeta = options?.agenticMeta;

  // Stage: post_process
  const postStart = Date.now();
  try {
    const knowledgePointIds =
      (chatRequest.learningContext?.knowledgeTracing?.teachingDecisions || [])
        .map((d: { knowledgePointId: string }) => d.knowledgePointId)
        .filter(Boolean);

    yield {
      stage: 'post_process',
      success: true,
      output: { knowledgePointIds },
      durationMs: Date.now() - postStart,
      completedAt: Date.now(),
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    yield {
      stage: 'post_process',
      success: false,
      error: { code: 'POST_PROCESS_FAILED', message: err.message },
      durationMs: Date.now() - postStart,
      completedAt: Date.now(),
    };
    throw err;
  }

  // Stage: persist
  const persistStart = Date.now();
  yield {
    stage: 'persist',
    success: true,
    output: { assistantText, wasAborted, cueUserReceived },
    durationMs: Date.now() - persistStart,
    completedAt: Date.now(),
  };

  // Stage: complete
  const completeStage: CapabilityStageResult = {
    stage: 'complete',
    success: true,
    output: {
      assistantText,
      totalActions,
      totalAgents,
      wasAborted,
      cueUserReceived,
      agenticMeta,
    },
    durationMs: Date.now() - startTime,
    completedAt: Date.now(),
  };
  yield completeStage;

  return {
    success: true,
    output: {
      assistantText,
      totalActions,
      totalAgents,
      wasAborted,
      cueUserReceived,
      agenticMeta,
    },
    stages: [],
    traceEvents: [],
    totalDurationMs: Date.now() - startTime,
  };
}
