/**
 * Deep Solve Capability Handler
 *
 * 多阶段深度解题流程：Planning -> Reasoning -> Writing
 *
 * 阶段说明：
 * 1. Planning: 分析问题，制定解题计划
 * 2. Reasoning: 执行工具调用，进行推理
 * 3. Writing: 生成最终答案
 */

import { streamText } from 'ai';
import type { CapabilityHandler, CapabilityRequest, CapabilityStageResult, CapabilityResult } from '../capability-runtime';
import type { DeepSolvePayload, DeepSolveResult } from '../../types/capability-payloads';
import type { TutorToolName } from '../../types/tutor-tools';
import type { ToolExecutionContext } from '../tutor-tools/types';
import { executeTools, formatToolResultsForPrompt } from '../tutor-tools/registry';
import { createLogger } from '@/lib/logger';

const log = createLogger('DeepSolveHandler');

const DEFAULT_DEEP_SOLVE_TOOLS: TutorToolName[] = ['rag', 'web_search', 'code_execution', 'reason'];

const PLANNING_SYSTEM_PROMPT = `你是一位专业的解题专家。请分析用户的问题，制定详细的解题计划。

要求：
1. 理解问题的核心要点
2. 识别问题类型（数学、物理、编程、概念理解等）
3. 列出解题步骤
4. 判断是否需要使用工具辅助（计算、搜索、代码执行等）

请用中文输出你的解题计划，格式如下：

## 问题分析
[问题的核心内容]

## 解题思路
[主要思路和方法]

## 步骤规划
1. [第一步]
2. [第二步]
...

## 工具需求
[是否需要使用工具，以及原因]`;

const REASONING_SYSTEM_PROMPT = `你是一位解题专家。基于已有的解题计划和工具结果，进行详细推理。

要求：
1. 按步骤进行推理
2. 结合工具返回的信息
3. 展示完整的推理过程
4. 验证中间结果

请用中文输出详细的推理过程。`;

const WRITING_SYSTEM_PROMPT = `你是一位专业的教育者。请基于前面的分析和推理，生成清晰、完整的最终答案。

要求：
1. 结构清晰，逻辑严谨
2. 包含关键步骤和结论
3. 适当使用公式、图表说明
4. 语言简洁易懂

请用中文输出最终答案。`;

interface ToolTrace {
  name: string;
  input: Record<string, unknown>;
  output: string;
  success: boolean;
}

export const deepSolveHandler: CapabilityHandler<DeepSolvePayload> = {
  capabilityId: 'deep_solve',

  validatePayload(payload: unknown): DeepSolvePayload {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload: expected object');
    }
    const p = payload as Record<string, unknown>;
    if (!p.message || typeof p.message !== 'string') {
      throw new Error('Invalid payload: message is required');
    }
    return {
      message: p.message,
      attachments: p.attachments as DeepSolvePayload['attachments'],
      enabledTools: p.enabledTools as DeepSolvePayload['enabledTools'],
      knowledgeBases: p.knowledgeBases as string[],
      detailedAnswer: typeof p.detailedAnswer === 'boolean' ? p.detailedAnswer : true,
      languageModel: p.languageModel as DeepSolvePayload['languageModel'],
      conversationContext: p.conversationContext as string,
    };
  },

  async *execute(
    request: CapabilityRequest<DeepSolvePayload>
  ): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
    const startTime = Date.now();
    const { message, enabledTools, knowledgeBases = [], detailedAnswer: _detailedAnswer = true, languageModel, conversationContext } = request.payload;
    const signal = request.signal;
    const activeTools = enabledTools?.length
      ? Array.from(new Set(enabledTools))
      : DEFAULT_DEEP_SOLVE_TOOLS;

    const toolTraces: ToolTrace[] = [];
    let planningResult = '';
    let reasoningResult = '';
    let finalResponse = '';

    // ============================================================
    // Stage 1: Planning
    // ============================================================
    const planningStart = Date.now();
    yield {
      stage: 'pre_process',
      success: true,
      output: { stage: 'planning', message: '正在分析问题...' },
      durationMs: Date.now() - planningStart,
      completedAt: Date.now(),
    };

    try {
      const planningMessages = [
        { role: 'system' as const, content: PLANNING_SYSTEM_PROMPT },
        ...(conversationContext ? [{ role: 'user' as const, content: `[上下文]\n${conversationContext}` }] : []),
        { role: 'user' as const, content: message },
      ];

      if (languageModel) {
        const planningStream = streamText({
          model: languageModel,
          messages: planningMessages,
          temperature: 0.3,
          abortSignal: signal,
        });

        for await (const chunk of planningStream.textStream) {
          planningResult += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'thinking',
                data: { content: chunk, stage: 'planning' },
              },
            },
            durationMs: Date.now() - planningStart,
            completedAt: Date.now(),
          };
        }
      } else {
        planningResult = `## 问题分析\n${message}\n\n## 解题思路\n正在分析中...`;
      }

      yield {
        stage: 'pre_process',
        success: true,
        output: { stage: 'planning', result: planningResult },
        durationMs: Date.now() - planningStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('[DeepSolve] Planning failed:', err);
      yield {
        stage: 'pre_process',
        success: false,
        error: { code: 'PLANNING_FAILED', message: err.message },
        durationMs: Date.now() - planningStart,
        completedAt: Date.now(),
      };
    }

    // ============================================================
    // Stage 2: Reasoning (Tool Execution)
    // ============================================================
    const reasoningStart = Date.now();
    yield {
      stage: 'agent_invoke',
      success: true,
      output: { stage: 'reasoning', message: '正在推理...' },
      durationMs: Date.now() - reasoningStart,
      completedAt: Date.now(),
    };

    let toolResultsText = '';
    if (activeTools.length > 0) {
      try {
        const toolContext: ToolExecutionContext = {
          message,
          config: {
            knowledgeBase: knowledgeBases[0],
            userId: request.userId,
            maxRAGResults: 5,
            maxWebResults: 5,
            codeTimeoutSec: 30,
          },
          stage: null,
          scenes: [],
          apiKey: '',
          languageModel,
        };

        const results = await executeTools(activeTools, toolContext);

        for (const [name, result] of results) {
          const toolId = `${name}-${Date.now()}`;

          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'tool_start',
                data: { toolName: name, toolId },
              },
            },
            durationMs: Date.now() - reasoningStart,
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
            durationMs: Date.now() - reasoningStart,
            completedAt: Date.now(),
          };

          toolTraces.push({
            name,
            input: { message },
            output: result.output || '',
            success: result.success,
          });
        }

        toolResultsText = formatToolResultsForPrompt(results);
      } catch (error) {
        log.error('[DeepSolve] Tool execution failed:', error);
      }
    }

    // Generate reasoning based on planning and tool results
    try {
      const reasoningMessages = [
        { role: 'system' as const, content: REASONING_SYSTEM_PROMPT },
        { role: 'user' as const, content: `问题：${message}\n\n解题计划：\n${planningResult}` },
        ...(toolResultsText ? [{ role: 'user' as const, content: `工具结果：\n${toolResultsText}` }] : []),
      ];

      if (languageModel) {
        const reasoningStream = streamText({
          model: languageModel,
          messages: reasoningMessages,
          temperature: 0.3,
          abortSignal: signal,
        });

        for await (const chunk of reasoningStream.textStream) {
          reasoningResult += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'thinking',
                data: { content: chunk, stage: 'reasoning' },
              },
            },
            durationMs: Date.now() - reasoningStart,
            completedAt: Date.now(),
          };
        }
      }

      yield {
        stage: 'agent_invoke',
        success: true,
        output: { stage: 'reasoning', result: reasoningResult },
        durationMs: Date.now() - reasoningStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('[DeepSolve] Reasoning failed:', err);
    }

    // ============================================================
    // Stage 3: Writing
    // ============================================================
    const writingStart = Date.now();
    yield {
      stage: 'post_process',
      success: true,
      output: { stage: 'writing', message: '正在生成答案...' },
      durationMs: Date.now() - writingStart,
      completedAt: Date.now(),
    };

    try {
      const writingMessages = [
        { role: 'system' as const, content: WRITING_SYSTEM_PROMPT },
        { role: 'user' as const, content: `问题：${message}` },
        ...(planningResult ? [{ role: 'assistant' as const, content: `[解题计划]\n${planningResult}` }] : []),
        ...(reasoningResult ? [{ role: 'assistant' as const, content: `[推理过程]\n${reasoningResult}` }] : []),
        { role: 'user' as const, content: '请生成最终答案。' },
      ];

      if (languageModel) {
        const writingStream = streamText({
          model: languageModel,
          messages: writingMessages,
          temperature: 0.5,
          abortSignal: signal,
        });

        for await (const chunk of writingStream.textStream) {
          finalResponse += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'text_delta',
                data: { content: chunk },
              },
            },
            durationMs: Date.now() - writingStart,
            completedAt: Date.now(),
          };
        }
      } else {
        finalResponse = reasoningResult || planningResult || '无法生成答案，请检查配置。';
      }

      yield {
        stage: 'post_process',
        success: true,
        output: { stage: 'writing', result: finalResponse },
        durationMs: Date.now() - writingStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('[DeepSolve] Writing failed:', err);
      yield {
        stage: 'post_process',
        success: false,
        error: { code: 'WRITING_FAILED', message: err.message },
        durationMs: Date.now() - writingStart,
        completedAt: Date.now(),
      };
    }

    // ============================================================
    // Stage 4: Complete
    // ============================================================
    const result: DeepSolveResult = {
      success: true,
      response: finalResponse,
      stages: {
        planning: planningResult,
        reasoning: reasoningResult,
        writing: finalResponse,
      },
      toolTraces,
    };

    yield {
      stage: 'complete',
      success: true,
      output: result as unknown as Record<string, unknown>,
      durationMs: Date.now() - startTime,
      completedAt: Date.now(),
    };

    return {
      success: true,
      output: result as unknown as Record<string, unknown>,
      stages: [],
      traceEvents: [],
      totalDurationMs: Date.now() - startTime,
    };
  },
};
