/**
 * AI导师工具注册表
 * 管理和执行所有 tutor tools
 */

import type { TutorToolName } from '../../types/tutor-tools';
import type { ToolExecutionContext, ToolExecutionResult, ToolRegistry } from './types';
import { executeBrainstorm } from './brainstorm';
import { executeReason } from './reason';
import { executeWebSearch } from './web-search';
import { executePaperSearch } from './paper-search';
import { executeRAG } from './rag';
import { executeCodeExecution } from './code-execution';

// 创建全局工具注册表
function createToolRegistry(): ToolRegistry {
  const registry: ToolRegistry = new Map();

  // 注册 brainstorm 工具
  registry.set('brainstorm', {
    name: 'brainstorm',
    execute: executeBrainstorm,
  });

  // 注册 reason 工具
  registry.set('reason', {
    name: 'reason',
    execute: executeReason,
  });

  // 注册 web_search 工具
  registry.set('web_search', {
    name: 'web_search',
    execute: executeWebSearch,
  });

  // 注册 paper_search 工具
  registry.set('paper_search', {
    name: 'paper_search',
    execute: executePaperSearch,
  });

  // 注册 rag 工具
  registry.set('rag', {
    name: 'rag',
    execute: executeRAG,
  });

  // 注册 code_execution 工具
  registry.set('code_execution', {
    name: 'code_execution',
    execute: executeCodeExecution,
  });

  return registry;
}

// 单例注册表
let globalRegistry: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!globalRegistry) {
    globalRegistry = createToolRegistry();
  }
  return globalRegistry;
}

/**
 * 执行单个工具
 */
export async function executeTool(
  toolName: TutorToolName,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const registry = getToolRegistry();
  const tool = registry.get(toolName);

  if (!tool) {
    return {
      success: false,
      output: '',
      error: `工具 ${toolName} 未找到`,
    };
  }

  return tool.execute(context);
}

/**
 * 批量执行多个工具（并行）
 */
export async function executeTools(
  toolNames: TutorToolName[],
  context: ToolExecutionContext,
): Promise<Map<TutorToolName, ToolExecutionResult>> {
  const results = new Map<TutorToolName, ToolExecutionResult>();

  // 并行执行所有工具
  const executions = toolNames.map(async (name) => {
    const result = await executeTool(name, context);
    results.set(name, result);
  });

  await Promise.all(executions);

  return results;
}

/**
 * 将工具结果格式化为系统提示词附加内容
 */
export function formatToolResultsForPrompt(
  results: Map<TutorToolName, ToolExecutionResult>,
): string {
  const sections: string[] = [];
  const toolLabels: Record<TutorToolName, string> = {
    brainstorm: '头脑风暴',
    rag: '知识库检索',
    web_search: '联网搜索',
    code_execution: '代码执行',
    reason: '深度推理',
    paper_search: '论文检索',
  };

  for (const [name, result] of results) {
    const label = toolLabels[name] || name;

    if (!result.success) {
      sections.push(`\n[${label}] ❌ 执行失败: ${result.error || '未知错误'}`);
      continue;
    }

    if (result.output) {
      sections.push(`\n[${label}] ✅\n${result.output}`);
    }
  }

  if (sections.length === 0) {
    return '';
  }

  return `\n\n---\n🔧 AI导师已使用以下工具辅助回答，请结合这些信息回答用户问题：\n${sections.join('\n')}`;
}
