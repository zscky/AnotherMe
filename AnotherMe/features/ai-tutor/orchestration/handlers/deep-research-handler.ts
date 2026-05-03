/**
 * Deep Research Capability Handler
 *
 * 多阶段深度研究流程：Rephrasing -> Decomposing -> Researching -> Reporting
 *
 * 阶段说明：
 * 1. Rephrasing: 重新表述研究主题
 * 2. Decomposing: 分解为子问题
 * 3. Researching: 多源搜索和收集信息
 * 4. Reporting: 生成研究报告
 */

import { streamText } from 'ai';
import type { CapabilityHandler, CapabilityRequest, CapabilityStageResult, CapabilityResult } from '../capability-runtime';
import type { DeepResearchPayload, DeepResearchResult, OutlineItem, ResearchSource } from '../../types/capability-payloads';
import type { TutorToolName } from '../../types/tutor-tools';
import type { ToolExecutionContext } from '../tutor-tools/types';
import { executeTool } from '../tutor-tools/registry';
import { createLogger } from '@/lib/logger';

const log = createLogger('DeepResearchHandler');

const REPHRASING_SYSTEM_PROMPT = `你是一位研究专家。请重新表述用户的研究主题，使其更加清晰和可研究。

要求：
1. 识别核心研究问题
2. 明确研究范围
3. 列出关键概念
4. 提出可能的研究角度

请用中文输出重新表述后的研究主题。`;

const DECOMPOSING_SYSTEM_PROMPT = `你是一位研究专家。请将研究主题分解为多个子问题。

要求：
1. 分解为3-5个关键子问题
2. 每个子问题应该具体且可回答
3. 子问题之间应该有逻辑关联
4. 按重要性排序

请用中文输出子问题列表，格式如下：

## 研究大纲

### 1. [子问题标题]
[子问题描述]

### 2. [子问题标题]
[子问题描述]

...`;

const REPORTING_SYSTEM_PROMPT = `你是一位学术写作专家。请基于研究结果，撰写一份完整的研究报告。

要求：
1. 结构清晰：引言、主体、结论
2. 引用来源
3. 客观准确
4. 语言专业但易懂

请用中文输出研究报告。`;

interface ResearchSourceResult {
  title: string;
  url?: string;
  content: string;
  type: ResearchSource;
}

interface ResearchTask {
  toolName: TutorToolName;
  toolId: string;
  query: string;
  sourceType: ResearchSource;
  context: ToolExecutionContext;
}

function generateOutlineId(): string {
  return `outline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSources(value: unknown): ResearchSource[] {
  const values = Array.isArray(value) ? value : ['web', 'papers', 'kb'];
  const sources = values.filter((source): source is ResearchSource =>
    source === 'web' || source === 'papers' || source === 'kb',
  );
  return sources.length ? Array.from(new Set(sources)) : ['web', 'papers', 'kb'];
}

function buildResearchAnalysisCode(sources: ResearchSourceResult[]): string {
  const payload = sources.map((source) => ({
    title: source.title,
    type: source.type,
    hasUrl: Boolean(source.url),
    contentLength: source.content.length,
  }));
  const payloadJson = JSON.stringify(payload);

  return `import json
from collections import Counter

sources = json.loads(${JSON.stringify(payloadJson)})
by_type = Counter(item["type"] for item in sources)
total_chars = sum(item["contentLength"] for item in sources)
with_url = sum(1 for item in sources if item["hasUrl"])

print(json.dumps({
    "source_count": len(sources),
    "source_count_by_type": dict(by_type),
    "sources_with_url": with_url,
    "total_content_chars": total_chars,
    "avg_content_chars": round(total_chars / len(sources), 2) if sources else 0,
}, ensure_ascii=False))`;
}

export const deepResearchHandler: CapabilityHandler<DeepResearchPayload> = {
  capabilityId: 'deep_research',

  validatePayload(payload: unknown): DeepResearchPayload {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload: expected object');
    }
    const p = payload as Record<string, unknown>;
    if (!p.topic || typeof p.topic !== 'string') {
      throw new Error('Invalid payload: topic is required');
    }
    return {
      topic: p.topic,
      sources: normalizeSources(p.sources),
      depth: (p.depth as DeepResearchPayload['depth']) || 'medium',
      knowledgeBases: p.knowledgeBases as string[],
      languageModel: p.languageModel as DeepResearchPayload['languageModel'],
      confirmedOutline: p.confirmedOutline as OutlineItem[],
    };
  },

  async *execute(
    request: CapabilityRequest<DeepResearchPayload>
  ): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
    const startTime = Date.now();
    const { topic, sources = ['web', 'papers', 'kb'], depth = 'medium', knowledgeBases = [], languageModel, confirmedOutline } = request.payload;
    const signal = request.signal;

    const allSources: ResearchSourceResult[] = [];
    let rephrasedTopic = '';
    let outline: OutlineItem[] = [];
    let researchNotes = '';
    let finalReport = '';

    // ============================================================
    // Stage 1: Rephrasing
    // ============================================================
    const rephrasingStart = Date.now();
    yield {
      stage: 'pre_process',
      success: true,
      output: { stage: 'rephrasing', message: '正在分析研究主题...' },
      durationMs: Date.now() - rephrasingStart,
      completedAt: Date.now(),
    };

    try {
      if (languageModel) {
        const rephrasingStream = streamText({
          model: languageModel,
          messages: [
            { role: 'system', content: REPHRASING_SYSTEM_PROMPT },
            { role: 'user', content: topic },
          ],
          temperature: 0.3,
          abortSignal: signal,
        });

        for await (const chunk of rephrasingStream.textStream) {
          rephrasedTopic += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'thinking',
                data: { content: chunk, stage: 'rephrasing' },
              },
            },
            durationMs: Date.now() - rephrasingStart,
            completedAt: Date.now(),
          };
        }
      } else {
        rephrasedTopic = topic;
      }

      yield {
        stage: 'pre_process',
        success: true,
        output: { stage: 'rephrasing', result: rephrasedTopic },
        durationMs: Date.now() - rephrasingStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      log.error('[DeepResearch] Rephrasing failed:', error);
      rephrasedTopic = topic;
    }

    // ============================================================
    // Stage 2: Decomposing
    // ============================================================
    const decomposingStart = Date.now();
    yield {
      stage: 'pre_process',
      success: true,
      output: { stage: 'decomposing', message: '正在分解研究问题...' },
      durationMs: Date.now() - decomposingStart,
      completedAt: Date.now(),
    };

    try {
      let decomposingResult = '';
      
      if (languageModel && !confirmedOutline) {
        const decomposingStream = streamText({
          model: languageModel,
          messages: [
            { role: 'system', content: DECOMPOSING_SYSTEM_PROMPT },
            { role: 'user', content: `研究主题：${rephrasedTopic}` },
          ],
          temperature: 0.3,
          abortSignal: signal,
        });

        for await (const chunk of decomposingStream.textStream) {
          decomposingResult += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'thinking',
                data: { content: chunk, stage: 'decomposing' },
              },
            },
            durationMs: Date.now() - decomposingStart,
            completedAt: Date.now(),
          };
        }

        // Parse outline from result
        const sections = decomposingResult.split(/###\s*\d+\.\s*/).filter(Boolean);
        outline = sections.map((section, index) => {
          const lines = section.trim().split('\n');
          const title = lines[0]?.trim() || `子问题 ${index + 1}`;
          return {
            id: generateOutlineId(),
            title,
            level: 1,
          };
        });
      } else if (confirmedOutline) {
        outline = confirmedOutline;
        decomposingResult = outline.map((item, i) => `### ${i + 1}. ${item.title}`).join('\n\n');
      }

      yield {
        stage: 'pre_process',
        success: true,
        output: { stage: 'decomposing', outline, result: decomposingResult },
        durationMs: Date.now() - decomposingStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      log.error('[DeepResearch] Decomposing failed:', error);
      outline = [{ id: generateOutlineId(), title: topic, level: 1 }];
    }

    // ============================================================
    // Stage 3: Researching (Multi-source search)
    // ============================================================
    const researchingStart = Date.now();
    yield {
      stage: 'agent_invoke',
      success: true,
      output: { stage: 'researching', message: '正在搜索资料...' },
      durationMs: Date.now() - researchingStart,
      completedAt: Date.now(),
    };

    const searchQueries = Array.from(new Set([topic, ...outline.slice(0, 3).map((item) => item.title)]));
    const researchTasks: ResearchTask[] = [];

    for (const query of searchQueries) {
      if (sources.includes('web')) {
        researchTasks.push({
          toolName: 'web_search',
          toolId: `web_search-${Date.now()}-${researchTasks.length}`,
          query,
          sourceType: 'web',
          context: {
            message: query,
            config: { maxWebResults: depth === 'deep' ? 10 : depth === 'medium' ? 5 : 3 },
            stage: null,
            scenes: [],
            apiKey: '',
            languageModel,
          },
        });
      }

      if (sources.includes('papers')) {
        researchTasks.push({
          toolName: 'paper_search',
          toolId: `paper_search-${Date.now()}-${researchTasks.length}`,
          query,
          sourceType: 'papers',
          context: {
            message: query,
            config: { maxPaperResults: depth === 'deep' ? 10 : 5 },
            stage: null,
            scenes: [],
            apiKey: '',
            languageModel,
          },
        });
      }

      if (sources.includes('kb')) {
        researchTasks.push({
          toolName: 'rag',
          toolId: `rag-${Date.now()}-${researchTasks.length}`,
          query,
          sourceType: 'kb',
          context: {
            message: query,
            config: {
              knowledgeBase: knowledgeBases[0],
              userId: request.userId,
              maxRAGResults: depth === 'deep' ? 10 : 5,
            },
            stage: null,
            scenes: [],
            apiKey: '',
            languageModel,
          },
        });
      }
    }

    for (const task of researchTasks) {
      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'tool_start',
            data: { toolName: task.toolName, toolId: task.toolId },
          },
        },
        durationMs: Date.now() - researchingStart,
        completedAt: Date.now(),
      };
    }

    const researchResults = await Promise.all(
      researchTasks.map(async (task) => {
        try {
          return {
            task,
            result: await executeTool(task.toolName, task.context),
          };
        } catch (error) {
          return {
            task,
            result: {
              success: false,
              output: '',
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }),
    );

    for (const { task, result } of researchResults) {
      if (task.toolName === 'web_search' && result.success && result.metadata?.sources) {
        const webSources = (result.metadata.sources as Array<{ title: string; url?: string; content?: string }>).map((s) => ({
          title: s.title,
          url: s.url,
          content: s.content || '',
          type: 'web' as ResearchSource,
        }));
        allSources.push(...webSources);
      } else if (result.success) {
        allSources.push({
          title: task.sourceType === 'papers' ? `论文: ${task.query}` : `知识库: ${task.query}`,
          content: result.output,
          type: task.sourceType,
        });
      }

      const noteTitle = task.sourceType === 'web'
        ? 'Web搜索'
        : task.sourceType === 'papers'
          ? '论文搜索'
          : '知识库检索';
      researchNotes += `\n\n### ${noteTitle}: ${task.query}\n${result.output || result.error || ''}`;

      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'tool_end',
            data: {
              toolName: task.toolName,
              toolId: task.toolId,
              success: result.success,
              output: result.output,
              error: result.error,
            },
          },
        },
        durationMs: Date.now() - researchingStart,
        completedAt: Date.now(),
      };
    }

    const codeToolId = `code_execution-${Date.now()}`;
    yield {
      stage: 'agent_stream',
      success: true,
      output: {
        agentEvent: {
          type: 'tool_start',
          data: { toolName: 'code_execution', toolId: codeToolId },
        },
      },
      durationMs: Date.now() - researchingStart,
      completedAt: Date.now(),
    };

    const codeResult = await executeTool('code_execution', {
      message: `请执行以下 Python 代码，对研究资料做结构化统计：\n\`\`\`python\n${buildResearchAnalysisCode(allSources)}\n\`\`\``,
      config: { codeTimeoutSec: 10 },
      stage: null,
      scenes: [],
      apiKey: '',
      languageModel,
    });
    researchNotes += `\n\n### 代码分析\n${codeResult.output || codeResult.error || ''}`;

    yield {
      stage: 'agent_stream',
      success: true,
      output: {
        agentEvent: {
          type: 'tool_end',
          data: {
            toolName: 'code_execution',
            toolId: codeToolId,
            success: codeResult.success,
            output: codeResult.output,
            error: codeResult.error,
          },
        },
      },
      durationMs: Date.now() - researchingStart,
      completedAt: Date.now(),
    };

    yield {
      stage: 'agent_invoke',
      success: true,
      output: { stage: 'researching', sources: allSources.length },
      durationMs: Date.now() - researchingStart,
      completedAt: Date.now(),
    };

    // ============================================================
    // Stage 4: Reporting
    // ============================================================
    const reportingStart = Date.now();
    yield {
      stage: 'post_process',
      success: true,
      output: { stage: 'reporting', message: '正在生成研究报告...' },
      durationMs: Date.now() - reportingStart,
      completedAt: Date.now(),
    };

    try {
      const sourcesText = allSources
        .map((s, i) => `[${i + 1}] ${s.title}${s.url ? ` (${s.url})` : ''}\n${s.content?.slice(0, 500)}...`)
        .join('\n\n');

      if (languageModel) {
        const reportingStream = streamText({
          model: languageModel,
          messages: [
            { role: 'system', content: REPORTING_SYSTEM_PROMPT },
            { role: 'user', content: `研究主题：${rephrasedTopic}` },
            { role: 'user', content: `研究大纲：\n${outline.map((item) => item.title).join('\n')}` },
            { role: 'user', content: `收集的资料：\n${sourcesText}` },
            { role: 'user', content: `工具研究笔记与代码分析：\n${researchNotes}` },
            { role: 'user', content: '请撰写完整的研究报告。' },
          ],
          temperature: 0.5,
          abortSignal: signal,
        });

        for await (const chunk of reportingStream.textStream) {
          finalReport += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'text_delta',
                data: { content: chunk },
              },
            },
            durationMs: Date.now() - reportingStart,
            completedAt: Date.now(),
          };
        }
      } else {
        finalReport = `# ${topic}\n\n${researchNotes}`;
      }

      yield {
        stage: 'post_process',
        success: true,
        output: { stage: 'reporting', result: finalReport },
        durationMs: Date.now() - reportingStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      log.error('[DeepResearch] Reporting failed:', error);
      finalReport = researchNotes;
    }

    // ============================================================
    // Stage 5: Complete
    // ============================================================
    const result: DeepResearchResult = {
      success: true,
      response: finalReport,
      outline,
      sources: allSources,
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
