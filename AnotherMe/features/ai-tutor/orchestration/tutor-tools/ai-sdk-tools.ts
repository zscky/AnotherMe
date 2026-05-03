/**
 * AI SDK Tools 定义
 *
 * 将六个 AI导师工具包装为 AI SDK 的 tool 格式，支持 agentic tool calling。
 * 工具列表：brainstorm / rag / web_search / code_execution / reason / paper_search
 *
 * 参考 DeepTutor 的 agentic pipeline 实现：
 * - thinking -> acting -> observing -> responding 四阶段
 * - 模型按需选择工具，而非预执行全部
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionContext, ToolExecutionResult } from './types';
import type { TutorToolName } from '../../types/tutor-tools';
import { executeBrainstorm } from './brainstorm';
import { executeReason } from './reason';
import { executeWebSearch } from './web-search';
import { executePaperSearch } from './paper-search';
import { executeRAG } from './rag';
import { executeCodeExecution } from './code-execution';

// ============================================================================
// Tool Schemas (匹配 DeepTutor 的工具参数定义)
// ============================================================================

const brainstormSchema = z.object({
  topic: z.string().describe('要头脑风暴的主题或问题'),
  numIdeas: z.number().optional().describe('期望生成的想法数量（默认5个）'),
});

const ragSchema = z.object({
  query: z.string().describe('检索查询语句'),
  knowledgeBase: z.string().optional().describe('知识库名称（如果有多个）'),
});

const webSearchSchema = z.object({
  query: z.string().describe('搜索查询语句'),
  maxResults: z.number().optional().describe('最大结果数（默认5个）'),
});

const codeExecutionSchema = z.object({
  intent: z.string().describe('代码执行意图描述'),
  code: z.string().optional().describe('可选：直接提供Python代码，如果不提供则自动生成'),
  timeout: z.number().optional().describe('超时时间（秒，默认30）'),
});

const reasonSchema = z.object({
  problem: z.string().describe('需要深度推理的问题'),
  context: z.string().optional().describe('额外的上下文信息'),
});

const paperSearchSchema = z.object({
  query: z.string().describe('论文搜索查询'),
  maxResults: z.number().optional().describe('最大结果数（默认5个）'),
  yearsLimit: z.number().optional().describe('限制最近N年的论文'),
});

// ============================================================================
// Tool Context Holder
// ============================================================================

/**
 * 工具执行上下文持有者
 * 由于 AI SDK 的 tool 在定义时无法访问运行时上下文，
 * 我们使用 AsyncLocalStorage 来传递上下文。
 */
import { AsyncLocalStorage } from 'async_hooks';

interface ToolContextStore {
  context: ToolExecutionContext;
  onToolStart?: (name: string, args: unknown) => void;
  onToolEnd?: (name: string, result: ToolExecutionResult) => void;
}

const toolContextStorage = new AsyncLocalStorage<ToolContextStore>();

/**
 * 在指定上下文中执行工具操作
 */
export function runWithToolContext<T>(
  store: ToolContextStore,
  callback: () => T
): T {
  return toolContextStorage.run(store, callback);
}

/**
 * 获取当前工具上下文
 */
function getToolContext(): ToolContextStore {
  const store = toolContextStorage.getStore();
  if (!store) {
    throw new Error('Tool context not available. Wrap tool execution with runWithToolContext.');
  }
  return store;
}

// ============================================================================
// Tool Executors (包装为 AI SDK tool 格式)
// ============================================================================

async function executeBrainstormTool(args: z.infer<typeof brainstormSchema>): Promise<string> {
  const { context, onToolStart, onToolEnd } = getToolContext();

  onToolStart?.('brainstorm', args);

  const result = await executeBrainstorm({
    ...context,
    message: args.topic,
  });

  onToolEnd?.('brainstorm', result);

  if (!result.success) {
    throw new Error(result.error || 'Brainstorm failed');
  }
  return result.output;
}

async function executeRAGTool(args: z.infer<typeof ragSchema>): Promise<string> {
  const { context, onToolStart, onToolEnd } = getToolContext();

  onToolStart?.('rag', args);

  const result = await executeRAG({
    ...context,
    message: args.query,
    config: {
      ...context.config,
      knowledgeBase: args.knowledgeBase || context.config.knowledgeBase,
    },
  });

  onToolEnd?.('rag', result);

  if (!result.success) {
    throw new Error(result.error || 'RAG failed');
  }
  return result.output;
}

async function executeWebSearchTool(args: z.infer<typeof webSearchSchema>): Promise<string> {
  const { context, onToolStart, onToolEnd } = getToolContext();

  onToolStart?.('web_search', args);

  const result = await executeWebSearch({
    ...context,
    message: args.query,
    config: {
      ...context.config,
      maxWebResults: args.maxResults || context.config.maxWebResults,
    },
  });

  onToolEnd?.('web_search', result);

  if (!result.success) {
    throw new Error(result.error || 'Web search failed');
  }
  return result.output;
}

async function executeCodeExecutionTool(args: z.infer<typeof codeExecutionSchema>): Promise<string> {
  const { context, onToolStart, onToolEnd } = getToolContext();

  onToolStart?.('code_execution', args);

  const message = args.code
    ? `\`\`\`python\n${args.code}\n\`\`\`\n${args.intent}`
    : args.intent;

  const result = await executeCodeExecution({
    ...context,
    message,
    config: {
      ...context.config,
      codeTimeoutSec: args.timeout || context.config.codeTimeoutSec,
    },
  });

  onToolEnd?.('code_execution', result);

  if (!result.success) {
    throw new Error(result.error || 'Code execution failed');
  }
  return result.output;
}

async function executeReasonTool(args: z.infer<typeof reasonSchema>): Promise<string> {
  const { context, onToolStart, onToolEnd } = getToolContext();

  onToolStart?.('reason', args);

  const message = args.context
    ? `${args.problem}\n\n上下文：${args.context}`
    : args.problem;

  const result = await executeReason({
    ...context,
    message,
  });

  onToolEnd?.('reason', result);

  if (!result.success) {
    throw new Error(result.error || 'Reasoning failed');
  }
  return result.output;
}

async function executePaperSearchTool(args: z.infer<typeof paperSearchSchema>): Promise<string> {
  const { context, onToolStart, onToolEnd } = getToolContext();

  onToolStart?.('paper_search', args);

  const result = await executePaperSearch({
    ...context,
    message: args.query,
    config: {
      ...context.config,
      maxPaperResults: args.maxResults || context.config.maxPaperResults,
    },
  });

  onToolEnd?.('paper_search', result);

  if (!result.success) {
    throw new Error(result.error || 'Paper search failed');
  }
  return result.output;
}

// ============================================================================
// AI SDK Tool Definitions
// ============================================================================

/**
 * 工具集合类型 - 使用更宽松的类型定义
 * AI SDK 6.0 使用 inputSchema 而不是 parameters
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tutorTools: Record<string, any> = {
  brainstorm: tool({
    description: 'AI辅助发散思考，生成创意点子和多角度思路。适用于需要创新想法、头脑风暴、探索不同解决方案的场景。',
    inputSchema: brainstormSchema,
    execute: executeBrainstormTool,
  }),

  rag: tool({
    description: '检索增强生成：从本地知识库（笔记、课堂资料、学习记录）中检索相关信息。适用于需要引用个人学习资料的问题。',
    inputSchema: ragSchema,
    execute: executeRAGTool,
  }),

  web_search: tool({
    description: '联网搜索：搜索互联网获取最新信息。适用于需要实时信息、新闻、当前事件或超出训练数据范围的知识。',
    inputSchema: webSearchSchema,
    execute: executeWebSearchTool,
  }),

  code_execution: tool({
    description: '代码执行：在沙箱环境中执行Python代码，进行计算、数据分析或算法验证。适用于数学计算、数据处理、算法实现等场景。',
    inputSchema: codeExecutionSchema,
    execute: executeCodeExecutionTool,
  }),

  reason: tool({
    description: '深度推理：进行多步骤、系统性的深度分析。适用于复杂问题拆解、逻辑推理、假设检验等需要严密思考的场景。',
    inputSchema: reasonSchema,
    execute: executeReasonTool,
  }),

  paper_search: tool({
    description: '论文检索：搜索arXiv学术论文。适用于学术研究、查找理论依据、了解前沿进展的场景。',
    inputSchema: paperSearchSchema,
    execute: executePaperSearchTool,
  }),
};

/**
 * 根据启用的工具列表构建工具对象
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildToolsForAgent(enabledTools: TutorToolName[]): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};

  for (const name of enabledTools) {
    if (name in tutorTools) {
      result[name] = tutorTools[name];
    }
  }

  return result;
}

// ============================================================================
// Re-export for convenience
// ============================================================================

export { toolContextStorage };
export type { ToolContextStore };
