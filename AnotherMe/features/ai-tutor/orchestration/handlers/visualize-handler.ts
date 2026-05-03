/**
 * Visualize Capability Handler
 *
 * 多阶段可视化生成流程：Analyzing -> Generating -> Reviewing
 *
 * 阶段说明：
 * 1. Analyzing: 分析可视化需求
 * 2. Generating: 生成可视化代码
 * 3. Reviewing: 审查和优化
 */

import { streamText } from 'ai';
import type { CapabilityHandler, CapabilityRequest, CapabilityStageResult, CapabilityResult } from '../capability-runtime';
import type { VisualizePayload, VisualizeResult, VisualizeFormat } from '../../types/capability-payloads';
import { renderChart, renderMermaid, type RenderedArtifact } from '../capability-tools';
import { createLogger } from '@/lib/logger';

const log = createLogger('VisualizeHandler');

const ANALYZING_PROMPT = `你是一位数据可视化专家。请分析用户的可视化需求。

要求：
1. 理解要展示的数据或概念
2. 推荐最适合的图表类型
3. 列出关键的可视化元素
4. 考虑交互性需求

请用中文输出分析结果。`;

const SVG_GENERATION_PROMPT = `你是一位SVG专家。请生成完整的SVG代码。

要求：
1. 代码完整可运行
2. 使用合适的颜色和样式
3. 包含必要的动画效果（可选）
4. 确保响应式设计

请直接输出SVG代码，不要包含markdown代码块标记。`;

const CHARTJS_GENERATION_PROMPT = `你是一位Chart.js专家。请生成完整的Chart.js配置代码。

要求：
1. 使用Chart.js 4.x语法
2. 配置完整可运行
3. 包含合适的颜色和样式
4. 添加必要的交互选项

请输出JavaScript代码，格式如下：

const config = {
  type: 'bar' | 'line' | 'pie' | ...,
  data: { ... },
  options: { ... }
};`;

const MERMAID_GENERATION_PROMPT = `你是一位Mermaid专家。请生成完整的Mermaid图表代码。

要求：
1. 使用正确的Mermaid语法
2. 选择合适的图表类型
3. 添加必要的样式
4. 确保可读性

请直接输出Mermaid代码，不要包含markdown代码块标记。`;

const HTML_GENERATION_PROMPT = `你是一位前端开发专家。请生成完整的HTML可视化页面。

要求：
1. 使用现代HTML5/CSS3
2. 包含必要的JavaScript交互
3. 响应式设计
4. 美观的样式

请输出完整的HTML代码。`;

const REVIEWING_PROMPT = `你是一位质量控制专家。请审查生成的可视化代码。

要求：
1. 检查语法正确性
2. 验证功能完整性
3. 提出改进建议
4. 确保最佳实践

请用中文输出审查结果。`;

function getGenerationPrompt(format: VisualizeFormat): string {
  switch (format) {
    case 'svg':
      return SVG_GENERATION_PROMPT;
    case 'chartjs':
      return CHARTJS_GENERATION_PROMPT;
    case 'mermaid':
      return MERMAID_GENERATION_PROMPT;
    case 'html':
      return HTML_GENERATION_PROMPT;
    default:
      return SVG_GENERATION_PROMPT;
  }
}

function getFormatExtension(format: VisualizeFormat): string {
  switch (format) {
    case 'svg':
      return 'svg';
    case 'chartjs':
      return 'js';
    case 'mermaid':
      return 'mmd';
    case 'html':
      return 'html';
    default:
      return 'txt';
  }
}

function cleanCodeBlock(code: string, format: VisualizeFormat): string {
  let cleaned = code;
  
  // Remove markdown code blocks
  cleaned = cleaned.replace(/^```\w*\n?/i, '');
  cleaned = cleaned.replace(/\n?```$/i, '');
  
  // Format-specific cleanup
  if (format === 'svg') {
    if (!cleaned.trim().startsWith('<svg')) {
      cleaned = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">\n${cleaned}\n</svg>`;
    }
  }
  
  if (format === 'mermaid') {
    cleaned = cleaned.trim();
  }
  
  return cleaned.trim();
}

export const visualizeHandler: CapabilityHandler<VisualizePayload> = {
  capabilityId: 'visualize',

  validatePayload(payload: unknown): VisualizePayload {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload: expected object');
    }
    const p = payload as Record<string, unknown>;
    if (!p.description || typeof p.description !== 'string') {
      throw new Error('Invalid payload: description is required');
    }
    return {
      description: p.description,
      format: (p.format as VisualizeFormat) || 'svg',
      data: p.data as Record<string, unknown>,
      languageModel: p.languageModel as VisualizePayload['languageModel'],
      size: p.size as VisualizePayload['size'],
    };
  },

  async *execute(
    request: CapabilityRequest<VisualizePayload>
  ): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
    const startTime = Date.now();
    const { description, format = 'svg', data, languageModel, size } = request.payload;
    const signal = request.signal;

    let analysis = '';
    let generatedCode = '';
    let review = '';
    let renderArtifact: RenderedArtifact | undefined;
    let renderError: string | undefined;

    // ============================================================
    // Stage 1: Analyzing
    // ============================================================
    const analyzingStart = Date.now();
    yield {
      stage: 'pre_process',
      success: true,
      output: { stage: 'analyzing', message: '正在分析可视化需求...' },
      durationMs: Date.now() - analyzingStart,
      completedAt: Date.now(),
    };

    try {
      const dataContext = data ? `\n\n数据：\n${JSON.stringify(data, null, 2)}` : '';
      const sizeContext = size ? `\n\n尺寸：${size.width || 'auto'} x ${size.height || 'auto'}` : '';

      if (languageModel) {
        const analyzingStream = streamText({
          model: languageModel,
          messages: [
            { role: 'system', content: ANALYZING_PROMPT },
            { role: 'user', content: `可视化需求：${description}${dataContext}${sizeContext}\n\n目标格式：${format}` },
          ],
          temperature: 0.3,
          abortSignal: signal,
        });

        for await (const chunk of analyzingStream.textStream) {
          analysis += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'thinking',
                data: { content: chunk, stage: 'analyzing' },
              },
            },
            durationMs: Date.now() - analyzingStart,
            completedAt: Date.now(),
          };
        }
      }

      yield {
        stage: 'pre_process',
        success: true,
        output: { stage: 'analyzing', result: analysis },
        durationMs: Date.now() - analyzingStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      log.error('[Visualize] Analyzing failed:', error);
    }

    // ============================================================
    // Stage 2: Generating
    // ============================================================
    const generatingStart = Date.now();
    yield {
      stage: 'agent_invoke',
      success: true,
      output: { stage: 'generating', message: `正在生成${format.toUpperCase()}代码...` },
      durationMs: Date.now() - generatingStart,
      completedAt: Date.now(),
    };

    try {
      const generationPrompt = getGenerationPrompt(format);
      const dataContext = data ? `\n\n数据：\n${JSON.stringify(data, null, 2)}` : '';
      const sizeContext = size ? `\n\n尺寸：${size.width || 800} x ${size.height || 600}` : '';

      if (languageModel) {
        const generatingStream = streamText({
          model: languageModel,
          messages: [
            { role: 'system', content: generationPrompt },
            { role: 'user', content: `需求：${description}${dataContext}${sizeContext}` },
          ],
          temperature: 0.2,
          abortSignal: signal,
        });

        for await (const chunk of generatingStream.textStream) {
          generatedCode += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'code_delta',
                data: { code: chunk, format, stage: 'generating' },
              },
            },
            durationMs: Date.now() - generatingStart,
            completedAt: Date.now(),
          };
        }
      }

      generatedCode = cleanCodeBlock(generatedCode, format);

      if (format === 'chartjs' || format === 'mermaid') {
        const renderStart = Date.now();
        const toolName = format === 'chartjs' ? 'chart_render' : 'mermaid_render';
        const toolId = `${toolName}-${Date.now()}`;
        yield {
          stage: 'agent_stream',
          success: true,
          output: {
            agentEvent: {
              type: 'tool_start',
              data: { toolName, toolId },
            },
          },
          durationMs: Date.now() - renderStart,
          completedAt: Date.now(),
        };

        const renderResult = format === 'chartjs'
          ? await renderChart({
              code: generatedCode,
              title: description,
              width: size?.width,
              height: size?.height,
            })
          : await renderMermaid({
              code: generatedCode,
              title: description,
            });
        renderArtifact = renderResult.metadata?.artifact;
        renderError = renderResult.error;

        yield {
          stage: 'agent_stream',
          success: true,
          output: {
            agentEvent: {
              type: 'tool_end',
              data: {
                toolName,
                toolId,
                success: renderResult.success,
                output: renderResult.output,
                error: renderResult.error,
              },
            },
          },
          durationMs: Date.now() - renderStart,
          completedAt: Date.now(),
        };
      }

      yield {
        stage: 'agent_invoke',
        success: true,
        output: { stage: 'generating', code: generatedCode, format, renderArtifact, renderError },
        durationMs: Date.now() - generatingStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      log.error('[Visualize] Generation failed:', error);
    }

    // ============================================================
    // Stage 3: Reviewing
    // ============================================================
    const reviewingStart = Date.now();
    yield {
      stage: 'post_process',
      success: true,
      output: { stage: 'reviewing', message: '正在审查代码...' },
      durationMs: Date.now() - reviewingStart,
      completedAt: Date.now(),
    };

    try {
      if (languageModel) {
        const reviewingStream = streamText({
          model: languageModel,
          messages: [
            { role: 'system', content: REVIEWING_PROMPT },
            { role: 'user', content: `生成的${format.toUpperCase()}代码：\n\`\`\`${getFormatExtension(format)}\n${generatedCode}\n\`\`\`` },
          ],
          temperature: 0.3,
          abortSignal: signal,
        });

        for await (const chunk of reviewingStream.textStream) {
          review += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'thinking',
                data: { content: chunk, stage: 'reviewing' },
              },
            },
            durationMs: Date.now() - reviewingStart,
            completedAt: Date.now(),
          };
        }
      }

      yield {
        stage: 'post_process',
        success: true,
        output: { stage: 'reviewing', result: review },
        durationMs: Date.now() - reviewingStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      log.error('[Visualize] Reviewing failed:', error);
    }

    // ============================================================
    // Stage 4: Complete
    // ============================================================
    const response = `# 可视化: ${description}

## 分析
${analysis}

## ${format.toUpperCase()}代码
\`\`\`${getFormatExtension(format)}
${generatedCode}
\`\`\`

## 审查
${review}`;

    // Generate preview for SVG and HTML
    let preview: string | undefined;
    if (format === 'svg' && generatedCode.includes('<svg')) {
      preview = generatedCode;
    } else if (format === 'html') {
      preview = generatedCode;
    } else if (renderArtifact?.content) {
      preview = renderArtifact.content;
    }

    const result: VisualizeResult = {
      success: true,
      response,
      render_type: format,
      code: {
        language: getFormatExtension(format),
        content: generatedCode,
      },
      preview,
      format,
      ...(renderArtifact || renderError
        ? {
            artifact: renderArtifact,
            renderError,
          } as unknown as Partial<VisualizeResult>
        : {}),
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
