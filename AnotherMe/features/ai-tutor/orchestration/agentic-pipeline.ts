/**
 * Agentic Pipeline for AI Tutor Chat
 *
 * 实现 DeepTutor 等价的 agentic tool calling 流程：
 * thinking -> acting -> observing -> responding
 *
 * 与当前预执行全部工具的方式不同，此 pipeline 让模型在生成过程中
 * 按需选择工具、观察结果、再生成最终回答。
 */

import { streamText, type LanguageModel } from 'ai';
import type { TutorToolName } from '../types/tutor-tools';
import type { ToolExecutionContext } from './tutor-tools/types';
import { buildToolsForAgent, runWithToolContext } from './tutor-tools/ai-sdk-tools';
import { createLogger } from '@/lib/logger';
import type { ThinkingConfig } from '@/lib/types/provider';

const log = createLogger('AgenticPipeline');

// ============================================================================
// Types
// ============================================================================

/**
 * 核心消息类型（简化版）
 */
type CoreMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export interface AgenticPipelineOptions {
  /** 用户消息 */
  userMessage: string;
  /** 对话历史 */
  conversationHistory: CoreMessage[];
  /** 启用的工具列表 */
  enabledTools: TutorToolName[];
  /** 工具执行上下文 */
  toolContext: ToolExecutionContext;
  /** 语言模型 */
  languageModel: LanguageModel;
  /** 思考配置 */
  thinkingConfig?: ThinkingConfig;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 中止信号 */
  signal?: AbortSignal;
}

export interface AgenticPipelineEvent {
  type:
    | 'thinking_start'
    | 'thinking_chunk'
    | 'thinking_end'
    | 'tool_start'
    | 'tool_end'
    | 'observation_start'
    | 'observation_chunk'
    | 'observation_end'
    | 'responding_start'
    | 'responding_chunk'
    | 'responding_end'
    | 'error'
    | 'complete';
  data?: unknown;
}

export interface ToolTrace {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  success: boolean;
  startTime: number;
  endTime: number;
}

export interface AgenticPipelineResult {
  success: boolean;
  response: string;
  thinking?: string;
  observation?: string;
  toolTraces: ToolTrace[];
  error?: string;
}

// ============================================================================
// System Prompts (四阶段提示词)
// ============================================================================

const THINKING_SYSTEM_PROMPT = `你是一位AI导师助手。请分析用户的问题，思考解决思路。

思考要点：
1. 理解用户问题的核心需求
2. 识别问题类型（知识问答、计算、创意、分析等）
3. 判断是否需要使用工具辅助回答
4. 规划回答的结构和要点

请用中文进行思考，展示你的分析过程。`;

const ACTING_SYSTEM_PROMPT = `你是一位AI导师助手。根据思考结果，决定是否需要调用工具来辅助回答。

可用工具：
{toolList}

工具使用原则：
1. 只在必要时调用工具
2. 可以并行调用多个相关工具
3. 每个工具调用都要有明确的目的
4. 如果不需要工具，直接回答用户问题

请根据思考结果，选择合适的工具进行调用。`;

const OBSERVING_SYSTEM_PROMPT = `你是一位AI导师助手。你已经调用了一些工具并获得了结果。

请分析工具返回的结果：
1. 总结每个工具返回的关键信息
2. 评估信息的质量和相关性
3. 识别信息中的矛盾或缺口
4. 整合所有信息形成统一的观察结论

请用中文输出你的观察和分析。`;

const RESPONDING_SYSTEM_PROMPT = `你是一位AI导师助手。基于之前的思考、工具调用和观察，生成最终回答。

回答要求：
1. 直接回应用户的问题
2. 结合工具返回的信息（如果有）
3. 结构清晰，重点突出
4. 使用中文回答
5. 如果使用了工具，适当引用工具提供的信息

请生成完整、有帮助的回答。`;

// ============================================================================
// Helper Functions
// ============================================================================

function formatToolList(enabledTools: TutorToolName[]): string {
  const toolDescriptions: Record<TutorToolName, string> = {
    brainstorm: 'brainstorm - 头脑风暴，生成创意点子',
    rag: 'rag - 从本地知识库检索信息',
    web_search: 'web_search - 联网搜索最新信息',
    code_execution: 'code_execution - 执行Python代码进行计算',
    reason: 'reason - 深度推理分析',
    paper_search: 'paper_search - 搜索学术论文',
  };

  return enabledTools.map(t => `- ${toolDescriptions[t]}`).join('\n') || '- 无可用工具';
}

function generateToolCallId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Stage 1: Thinking
// ============================================================================

async function* stageThinking(
  options: AgenticPipelineOptions
): AsyncGenerator<AgenticPipelineEvent, string> {
  const { userMessage, conversationHistory, languageModel, systemPrompt, signal } = options;

  log.info('[AgenticPipeline] Stage: Thinking started');
  yield { type: 'thinking_start' };

  const messages: CoreMessage[] = [
    { role: 'system', content: systemPrompt || THINKING_SYSTEM_PROMPT },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  let thinking = '';

  try {
    const result = streamText({
      model: languageModel,
      messages,
      temperature: 0.3,
      abortSignal: signal,
    });

    for await (const chunk of result.textStream) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      thinking += chunk;
      yield { type: 'thinking_chunk', data: { chunk } };
    }

    log.info('[AgenticPipeline] Stage: Thinking completed', { length: thinking.length });
    yield { type: 'thinking_end', data: { thinking } };

    return thinking;
  } catch (error) {
    log.error('[AgenticPipeline] Stage: Thinking failed', error);
    throw error;
  }
}

// ============================================================================
// Stage 2: Acting (Tool Calling)
// ============================================================================

async function* stageActing(
  options: AgenticPipelineOptions,
  thinking: string
): AsyncGenerator<AgenticPipelineEvent, { toolTraces: ToolTrace[] }> {
  const { userMessage, conversationHistory, enabledTools, toolContext, languageModel, signal } = options;

  log.info('[AgenticPipeline] Stage: Acting started', { enabledTools });

  if (enabledTools.length === 0) {
    log.info('[AgenticPipeline] No tools enabled, skipping acting stage');
    return { toolTraces: [] };
  }

  const tools = buildToolsForAgent(enabledTools);

  if (Object.keys(tools).length === 0) {
    log.info('[AgenticPipeline] No valid tools built, skipping acting stage');
    return { toolTraces: [] };
  }

  const actingPrompt = ACTING_SYSTEM_PROMPT.replace('{toolList}', formatToolList(enabledTools));

  const messages: CoreMessage[] = [
    { role: 'system', content: actingPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: `[思考过程]\n${thinking}\n\n现在决定是否需要调用工具。` },
  ];

  const toolTraces: ToolTrace[] = [];

  try {
    // 使用 runWithToolContext 包装工具执行
    const result = await runWithToolContext(
      {
        context: toolContext,
        onToolStart: (name, args) => {
          log.info(`[AgenticPipeline] Tool started: ${name}`, args);
          // 发送工具开始事件
        },
        onToolEnd: (name, result) => {
          log.info(`[AgenticPipeline] Tool completed: ${name}`, { success: result.success });
        },
      },
      async () => {
        const streamResult = streamText({
          model: languageModel,
          messages,
          tools,
          temperature: 0.2,
          abortSignal: signal,
        });

        // 收集文本输出
        for await (const _chunk of streamResult.textStream) {
          if (signal?.aborted) {
            throw new Error('Aborted');
          }
          // 文本输出在 acting 阶段主要是思考过程
        }

        // 获取工具调用结果
        const toolResults = await streamResult.toolResults;

        // 处理工具结果
        if (toolResults) {
          for (const toolResult of toolResults) {
            // 使用类型断言处理工具结果
            const tr = toolResult as {
              toolName: string;
              toolCallId: string;
              input?: Record<string, unknown>;
              output?: string;
              result?: string;
            };

            const trace: ToolTrace = {
              id: tr.toolCallId || generateToolCallId(),
              name: tr.toolName,
              arguments: tr.input || {},
              result: tr.output || tr.result || '',
              success: true,
              startTime: Date.now(),
              endTime: Date.now(),
            };

            toolTraces.push(trace);
          }
        }

        return toolTraces;
      }
    );

    // streamText exposes completed tool results after the step finishes. Emit a
    // paired start/end sequence here so the shared chat UI can render traces.
    for (const trace of result) {
      yield {
        type: 'tool_start',
        data: {
          toolName: trace.name,
          toolId: trace.id,
          args: trace.arguments,
        },
      };
      yield {
        type: 'tool_end',
        data: {
          toolName: trace.name,
          toolId: trace.id,
          success: trace.success,
          output: trace.result,
        },
      };
    }

    log.info('[AgenticPipeline] Stage: Acting completed', { toolCount: toolTraces.length });

    return { toolTraces };
  } catch (error) {
    log.error('[AgenticPipeline] Stage: Acting failed', error);
    throw error;
  }
}

// ============================================================================
// Stage 3: Observing
// ============================================================================

async function* stageObserving(
  options: AgenticPipelineOptions,
  thinking: string,
  toolTraces: ToolTrace[]
): AsyncGenerator<AgenticPipelineEvent, string> {
  const { userMessage, conversationHistory, languageModel, signal } = options;

  log.info('[AgenticPipeline] Stage: Observing started');
  yield { type: 'observation_start' };

  if (toolTraces.length === 0) {
    log.info('[AgenticPipeline] No tool traces, skipping observation');
    yield { type: 'observation_end', data: { observation: '' } };
    return '';
  }

  // 格式化工具结果
  const toolResultsText = toolTraces
    .map((trace, idx) => `
工具 ${idx + 1}: ${trace.name}
参数: ${JSON.stringify(trace.arguments)}
结果: ${trace.result.slice(0, 500)}${trace.result.length > 500 ? '...' : ''}
    `.trim())
    .join('\n\n');

  const messages: CoreMessage[] = [
    { role: 'system', content: OBSERVING_SYSTEM_PROMPT },
    ...conversationHistory,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: `[思考过程]\n${thinking}` },
    { role: 'user', content: `工具调用结果：\n\n${toolResultsText}\n\n请分析以上工具结果。` },
  ];

  let observation = '';

  try {
    const result = streamText({
      model: languageModel,
      messages,
      temperature: 0.3,
      abortSignal: signal,
    });

    for await (const chunk of result.textStream) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      observation += chunk;
      yield { type: 'observation_chunk', data: { chunk } };
    }

    log.info('[AgenticPipeline] Stage: Observing completed', { length: observation.length });
    yield { type: 'observation_end', data: { observation } };

    return observation;
  } catch (error) {
    log.error('[AgenticPipeline] Stage: Observing failed', error);
    throw error;
  }
}

// ============================================================================
// Stage 4: Responding
// ============================================================================

async function* stageResponding(
  options: AgenticPipelineOptions,
  thinking: string,
  observation: string,
  toolTraces: ToolTrace[]
): AsyncGenerator<AgenticPipelineEvent, string> {
  const { userMessage, conversationHistory, languageModel, signal } = options;

  log.info('[AgenticPipeline] Stage: Responding started');
  yield { type: 'responding_start' };

  const contextParts: string[] = [];

  if (thinking) {
    contextParts.push(`[思考过程]\n${thinking}`);
  }

  if (observation) {
    contextParts.push(`[工具结果分析]\n${observation}`);
  }

  if (toolTraces.length > 0) {
    const toolSummary = toolTraces
      .map(t => `- ${t.name}: ${t.result.slice(0, 200)}${t.result.length > 200 ? '...' : ''}`)
      .join('\n');
    contextParts.push(`[工具结果摘要]\n${toolSummary}`);
  }

  const messages: CoreMessage[] = [
    { role: 'system', content: RESPONDING_SYSTEM_PROMPT },
    ...conversationHistory,
    ...(contextParts.length > 0
      ? [{ role: 'assistant' as const, content: contextParts.join('\n\n') }]
      : []),
    { role: 'user', content: userMessage },
  ];

  let response = '';

  try {
    const result = streamText({
      model: languageModel,
      messages,
      temperature: 0.5,
      abortSignal: signal,
    });

    for await (const chunk of result.textStream) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      response += chunk;
      yield { type: 'responding_chunk', data: { chunk } };
    }

    log.info('[AgenticPipeline] Stage: Responding completed', { length: response.length });
    yield { type: 'responding_end', data: { response } };

    return response;
  } catch (error) {
    log.error('[AgenticPipeline] Stage: Responding failed', error);
    throw error;
  }
}

// ============================================================================
// Main Pipeline
// ============================================================================

/**
 * 运行完整的 agentic pipeline
 *
 * 四阶段流程：thinking -> acting -> observing -> responding
 */
export async function* runAgenticPipeline(
  options: AgenticPipelineOptions
): AsyncGenerator<AgenticPipelineEvent, AgenticPipelineResult> {
  const startTime = Date.now();
  log.info('[AgenticPipeline] Started', { enabledTools: options.enabledTools });

  try {
    // Stage 1: Thinking
    const thinking = yield* stageThinking(options);

    // Stage 2: Acting (Tool Calling)
    const { toolTraces } = yield* stageActing(options, thinking);

    // Stage 3: Observing
    const observation = yield* stageObserving(options, thinking, toolTraces);

    // Stage 4: Responding
    const response = yield* stageResponding(options, thinking, observation, toolTraces);

    const result: AgenticPipelineResult = {
      success: true,
      response,
      thinking,
      observation,
      toolTraces,
    };

    yield { type: 'complete', data: result };

    log.info('[AgenticPipeline] Completed', {
      duration: Date.now() - startTime,
      toolCount: toolTraces.length,
      responseLength: response.length,
    });

    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('[AgenticPipeline] Failed', err);

    yield { type: 'error', data: { error: err.message } };

    return {
      success: false,
      response: '',
      toolTraces: [],
      error: err.message,
    };
  }
}

/**
 * 简化的 agentic pipeline，直接返回结果而不流式输出
 */
export async function runAgenticPipelineSimple(
  options: AgenticPipelineOptions
): Promise<AgenticPipelineResult> {
  const events: AgenticPipelineEvent[] = [];

  for await (const event of runAgenticPipeline(options)) {
    events.push(event);
  }

  const completeEvent = events.find(e => e.type === 'complete');
  const errorEvent = events.find(e => e.type === 'error');

  if (completeEvent?.data) {
    return completeEvent.data as AgenticPipelineResult;
  }

  if (errorEvent?.data) {
    return {
      success: false,
      response: '',
      toolTraces: [],
      error: (errorEvent.data as { error: string }).error,
    };
  }

  return {
    success: false,
    response: '',
    toolTraces: [],
    error: 'Pipeline completed without result',
  };
}
