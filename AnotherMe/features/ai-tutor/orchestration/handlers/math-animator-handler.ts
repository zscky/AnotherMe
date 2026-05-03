/**
 * Math Animator Capability Handler
 *
 * 多阶段数学动画生成流程：
 * Concept Analysis -> Concept Design -> Code Generation -> Render
 *
 * 阶段说明：
 * 1. Concept Analysis: 分析数学概念
 * 2. Concept Design: 设计动画场景
 * 3. Code Generation: 生成Manim代码
 * 4. Render: 渲染动画（可选）
 */

import { streamText } from 'ai';
import type { CapabilityHandler, CapabilityRequest, CapabilityStageResult, CapabilityResult } from '../capability-runtime';
import type { MathAnimatorPayload, MathAnimatorResult } from '../../types/capability-payloads';
import { renderManim, synthesizeSpeech, type RenderedArtifact, type SynthesizeSpeechParams } from '../capability-tools';
import { createLogger } from '@/lib/logger';

const log = createLogger('MathAnimatorHandler');

const CONCEPT_ANALYSIS_PROMPT = `你是一位数学教育专家。请分析用户提供的数学概念，为动画制作做准备。

要求：
1. 解释概念的核心内容
2. 列出关键的可视化元素
3. 识别需要展示的步骤或过程
4. 建议适合的动画效果

请用中文输出分析结果。`;

const CONCEPT_DESIGN_PROMPT = `你是一位动画设计师。请基于概念分析，设计详细的动画场景。

要求：
1. 描述每个场景的内容
2. 说明动画的顺序和过渡
3. 标注需要展示的关键元素
4. 估计每个场景的时长

请用中文输出场景设计。格式如下：

## 场景设计

### 场景1: [标题]
- 内容: [描述]
- 时长: [秒]
- 元素: [列表]

### 场景2: [标题]
...

## 总时长: [秒]`;

const CODE_GENERATION_PROMPT = `你是数学动画能力中的 Manim 代码生成器。请基于场景设计，生成完整、可运行的 Manim CE Python 代码。

要求：
1. 直接输出完整 Python 代码，不要输出 Markdown 代码块、分析文字或解释。
2. 至少包含一个可渲染的 Scene 子类，例如 class GeneratedScene(Scene):。
3. 当前环境是 Manim CE 0.20.x，可能没有本地 LaTeX，默认禁止使用 Tex、MathTex、SingleStringMathTex、MarkupText 或任何 LaTeX 依赖。
4. 数学公式优先用 Text、DecimalNumber、几何图形、VGroup 等表达。
5. 所有几何点、路径点、顶点坐标必须是 3D 形式，例如 [x, y, 0]，不要写 [x, y]。
6. 禁止使用 stroke_dash_pattern 参数，Manim CE 0.20.1 不支持。
7. 禁止使用 self.save_state()。
8. 只有当类继承 MovingCameraScene 时，才允许使用 self.camera.frame；普通 Scene 中不要写相机 frame 动画。
9. 控制画面边界，文字与图形不要重叠，优先使用 scale、to_edge、next_to、arrange。
10. 动画不要过短，安排清晰的教学步骤、run_time 和 self.wait，结尾保留稳定停留。

请直接输出 Python 代码。`;

const CODE_REPAIR_PROMPT = `你是数学动画能力中的 Manim 代码修复器。

根据 Manim 渲染错误修复已有代码。要求：
1. 只输出修复后的完整 Python 代码，不要输出 Markdown 代码块、分析文字或解释。
2. 优先做最小修改，不要丢掉用户原始教学目标。
3. 当前环境是 Manim CE 0.20.x，可能没有本地 LaTeX，默认禁止使用 Tex、MathTex、SingleStringMathTex、MarkupText。
4. 如果错误与 LaTeX 有关，改用 Text、几何图形或普通字符表达公式。
5. 如果错误包含 stroke_dash_pattern，移除该参数。
6. 如果错误包含 save_state，删除该调用。
7. 如果错误与 self.camera.frame 有关，要么把场景类改为 MovingCameraScene，要么删除相机 frame 动画。
8. 如果错误与点坐标维度有关，把二维坐标改成三维坐标。
9. 修复后仍需包含可渲染的 Scene 子类，并保持动画节奏和收尾停留。`;

const STORYBOARD_PROMPT = `你是一位动画导演。请为数学概念动画创建分镜脚本。

要求：
1. 每帧描述清晰
2. 包含视觉元素说明
3. 标注动画效果
4. 适合教学使用

请用中文输出分镜脚本。`;

interface StoryboardFrame {
  frame: number;
  description: string;
  code?: string;
}

interface RetryAttempt {
  attempt: number;
  error: string;
}

function extractGeneratedCode(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as { code?: unknown };
    if (typeof parsed.code === 'string') {
      return parsed.code.trim();
    }
  } catch {
    // Model output is usually plain Python, but retry prompts may return JSON.
  }

  const fenced = trimmed.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? trimmed)
    .replace(/^```python\n?/i, '')
    .replace(/^```\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();
}

async function repairManimCode(params: {
  languageModel: NonNullable<MathAnimatorPayload['languageModel']>;
  concept: string;
  currentCode: string;
  errorMessage: string;
  attempt: number;
  signal?: AbortSignal;
}): Promise<string> {
  const repairStream = streamText({
    model: params.languageModel,
    messages: [
      { role: 'system', content: CODE_REPAIR_PROMPT },
      {
        role: 'user',
        content: [
          `用户需求：${params.concept}`,
          `当前是第 ${params.attempt} 次修复。`,
          `渲染错误：\n${params.errorMessage.slice(0, 6000)}`,
          `当前失败代码：\n${params.currentCode}`,
        ].join('\n\n'),
      },
    ],
    temperature: 0.1,
    abortSignal: params.signal,
  });

  let repaired = '';
  for await (const chunk of repairStream.textStream) {
    repaired += chunk;
  }
  return extractGeneratedCode(repaired) || params.currentCode;
}

export const mathAnimatorHandler: CapabilityHandler<MathAnimatorPayload> = {
  capabilityId: 'math_animator',

  validatePayload(payload: unknown): MathAnimatorPayload {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload: expected object');
    }
    const p = payload as Record<string, unknown>;
    if (!p.concept || typeof p.concept !== 'string') {
      throw new Error('Invalid payload: concept is required');
    }
    return {
      concept: p.concept,
      outputFormat: (p.outputFormat as MathAnimatorPayload['outputFormat']) || 'video',
      duration: p.duration as number,
      style: (p.style as MathAnimatorPayload['style']) || 'default',
      referenceImages: p.referenceImages as MathAnimatorPayload['referenceImages'],
      languageModel: p.languageModel as MathAnimatorPayload['languageModel'],
    };
  },

  async *execute(
    request: CapabilityRequest<MathAnimatorPayload>
  ): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
    const startTime = Date.now();
    const { concept, outputFormat = 'video', duration = 60, style = 'default', languageModel } = request.payload;
    const signal = request.signal;

    let conceptAnalysis = '';
    let conceptDesign = '';
    let manimCode = '';
    let storyboard: StoryboardFrame[] = [];
    let videoArtifact: RenderedArtifact | undefined;
    let audioArtifact: RenderedArtifact | undefined;
    let renderError: string | undefined;
    let ttsError: string | undefined;
    const retryHistory: RetryAttempt[] = [];

    // ============================================================
    // Stage 1: Concept Analysis
    // ============================================================
    const analysisStart = Date.now();
    yield {
      stage: 'pre_process',
      success: true,
      output: { stage: 'analyzing', message: '正在分析数学概念...' },
      durationMs: Date.now() - analysisStart,
      completedAt: Date.now(),
    };

    try {
      if (languageModel) {
        const analysisStream = streamText({
          model: languageModel,
          messages: [
            { role: 'system', content: CONCEPT_ANALYSIS_PROMPT },
            { role: 'user', content: concept },
          ],
          temperature: 0.3,
          abortSignal: signal,
        });

        for await (const chunk of analysisStream.textStream) {
          conceptAnalysis += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'thinking',
                data: { content: chunk, stage: 'analyzing' },
              },
            },
            durationMs: Date.now() - analysisStart,
            completedAt: Date.now(),
          };
        }
      }

      yield {
        stage: 'pre_process',
        success: true,
        output: { stage: 'analyzing', result: conceptAnalysis },
        durationMs: Date.now() - analysisStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      log.error('[MathAnimator] Concept analysis failed:', error);
    }

    // ============================================================
    // Stage 2: Concept Design
    // ============================================================
    const designStart = Date.now();
    yield {
      stage: 'pre_process',
      success: true,
      output: { stage: 'designing', message: '正在设计动画场景...' },
      durationMs: Date.now() - designStart,
      completedAt: Date.now(),
    };

    try {
      if (languageModel) {
        const designStream = streamText({
          model: languageModel,
          messages: [
            { role: 'system', content: CONCEPT_DESIGN_PROMPT },
            { role: 'user', content: `数学概念：${concept}\n\n分析结果：${conceptAnalysis}\n\n目标时长：${duration}秒\n风格：${style}` },
          ],
          temperature: 0.4,
          abortSignal: signal,
        });

        for await (const chunk of designStream.textStream) {
          conceptDesign += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'thinking',
                data: { content: chunk, stage: 'designing' },
              },
            },
            durationMs: Date.now() - designStart,
            completedAt: Date.now(),
          };
        }
      }

      yield {
        stage: 'pre_process',
        success: true,
        output: { stage: 'designing', result: conceptDesign },
        durationMs: Date.now() - designStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      log.error('[MathAnimator] Concept design failed:', error);
    }

    // ============================================================
    // Stage 3: Code Generation / Storyboard
    // ============================================================
    const generationStart = Date.now();

    if (outputFormat === 'video') {
      yield {
        stage: 'agent_invoke',
        success: true,
        output: { stage: 'generating', message: '正在生成Manim代码...' },
        durationMs: Date.now() - generationStart,
        completedAt: Date.now(),
      };

      try {
        if (languageModel) {
          const codeStream = streamText({
            model: languageModel,
            messages: [
              { role: 'system', content: CODE_GENERATION_PROMPT },
              {
                role: 'user',
                content: [
                  `用户需求：${concept}`,
                  `目标时长：${duration} 秒`,
                  `视觉风格：${style}`,
                  `概念分析：\n${conceptAnalysis}`,
                  `场景设计：\n${conceptDesign}`,
                  '请生成完整的 Manim Python 代码。',
                ].join('\n\n'),
              },
            ],
            temperature: 0.2,
            abortSignal: signal,
          });

          for await (const chunk of codeStream.textStream) {
            manimCode += chunk;
            yield {
              stage: 'agent_stream',
              success: true,
              output: {
                agentEvent: {
                  type: 'code_delta',
                  data: { code: chunk, stage: 'generating' },
                },
              },
              durationMs: Date.now() - generationStart,
              completedAt: Date.now(),
            };
          }
        }

        manimCode = extractGeneratedCode(manimCode);

        yield {
          stage: 'agent_invoke',
          success: true,
          output: { stage: 'generating', code: manimCode },
          durationMs: Date.now() - generationStart,
          completedAt: Date.now(),
        };

        const renderStart = Date.now();
        const toolId = `manim_render-${Date.now()}`;
        yield {
          stage: 'agent_stream',
          success: true,
          output: {
            agentEvent: {
              type: 'tool_start',
              data: { toolName: 'manim_render', toolId },
            },
          },
          durationMs: Date.now() - renderStart,
          completedAt: Date.now(),
        };

        const maxRepairAttempts = languageModel ? 2 : 0;
        let renderResult = await renderManim({
          code: manimCode,
          quality: 'low',
          timeoutSec: 240,
        });

        for (let attempt = 1; !renderResult.success && attempt <= maxRepairAttempts; attempt += 1) {
          const errorMessage = renderResult.error || renderResult.output || 'Manim 渲染失败';
          retryHistory.push({ attempt, error: errorMessage.slice(0, 2000) });

          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'tool_end',
                data: {
                  toolName: 'manim_render',
                  toolId,
                  success: false,
                  output: `第 ${attempt} 次渲染失败，正在修复代码后重试。`,
                  error: errorMessage,
                },
              },
            },
            durationMs: Date.now() - renderStart,
            completedAt: Date.now(),
          };

          manimCode = await repairManimCode({
            languageModel: languageModel!,
            concept,
            currentCode: manimCode,
            errorMessage,
            attempt,
            signal,
          });

          renderResult = await renderManim({
            code: manimCode,
            quality: 'low',
            timeoutSec: 240,
          });
        }

        videoArtifact = renderResult.metadata?.artifact;
        renderError = renderResult.error;

        yield {
          stage: 'agent_stream',
          success: true,
          output: {
            agentEvent: {
              type: 'tool_end',
              data: {
                toolName: 'manim_render',
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
      } catch (error) {
        log.error('[MathAnimator] Code generation failed:', error);
      }
    } else {
      // Storyboard mode
      yield {
        stage: 'agent_invoke',
        success: true,
        output: { stage: 'generating', message: '正在生成分镜脚本...' },
        durationMs: Date.now() - generationStart,
        completedAt: Date.now(),
      };

      try {
        let storyboardText = '';
        if (languageModel) {
          const storyboardStream = streamText({
            model: languageModel,
            messages: [
              { role: 'system', content: STORYBOARD_PROMPT },
              { role: 'user', content: `数学概念：${concept}\n\n场景设计：\n${conceptDesign}` },
            ],
            temperature: 0.4,
            abortSignal: signal,
          });

          for await (const chunk of storyboardStream.textStream) {
            storyboardText += chunk;
            yield {
              stage: 'agent_stream',
              success: true,
              output: {
                agentEvent: {
                  type: 'text_delta',
                  data: { content: chunk, stage: 'generating' },
                },
              },
              durationMs: Date.now() - generationStart,
              completedAt: Date.now(),
            };
          }
        }

        // Parse storyboard into frames
        const frameMatches = storyboardText.split(/(?:帧|Frame)\s*(\d+)/i);
        for (let i = 1; i < frameMatches.length; i += 2) {
          storyboard.push({
            frame: parseInt(frameMatches[i], 10) || Math.floor(i / 2) + 1,
            description: frameMatches[i + 1]?.trim() || '',
          });
        }

        if (storyboard.length === 0) {
          storyboard = [
            { frame: 1, description: storyboardText.slice(0, 500) },
          ];
        }

        yield {
          stage: 'agent_invoke',
          success: true,
          output: { stage: 'generating', storyboard },
          durationMs: Date.now() - generationStart,
          completedAt: Date.now(),
        };
      } catch (error) {
        log.error('[MathAnimator] Storyboard generation failed:', error);
      }
    }

    const narrationText = [
      `数学概念：${concept}`,
      conceptAnalysis ? `概念分析：${conceptAnalysis}` : '',
      conceptDesign ? `场景设计：${conceptDesign}` : '',
    ].filter(Boolean).join('\n\n').slice(0, 2000);

    if (narrationText) {
      const ttsConfig = (request.payload as MathAnimatorPayload & {
        tts?: Partial<SynthesizeSpeechParams> & { enabled?: boolean };
      }).tts;

      if (ttsConfig?.enabled === true) {
        const ttsStart = Date.now();
        const toolId = `tts-${Date.now()}`;
        yield {
          stage: 'agent_stream',
          success: true,
          output: {
            agentEvent: {
              type: 'tool_start',
              data: { toolName: 'tts', toolId },
            },
          },
          durationMs: Date.now() - ttsStart,
          completedAt: Date.now(),
        };

        const ttsResult = await synthesizeSpeech({
          text: narrationText,
          ...ttsConfig,
        });
        audioArtifact = ttsResult.metadata?.artifact;
        ttsError = ttsResult.error;

        yield {
          stage: 'agent_stream',
          success: true,
          output: {
            agentEvent: {
              type: 'tool_end',
              data: {
                toolName: 'tts',
                toolId,
                success: ttsResult.success,
                output: ttsResult.output,
                error: ttsResult.error,
              },
            },
          },
          durationMs: Date.now() - ttsStart,
          completedAt: Date.now(),
        };
      }
    }

    // ============================================================
    // Stage 4: Complete
    // ============================================================
    const response = outputFormat === 'video'
      ? `# 数学动画: ${concept}\n\n## 概念分析\n${conceptAnalysis}\n\n## 场景设计\n${conceptDesign}\n\n## 渲染结果\n${videoArtifact?.url ? `视频：${videoArtifact.url}` : `未生成视频：${renderError || '未知原因'}`}\n\n## Manim代码\n\`\`\`python\n${manimCode}\n\`\`\``
      : `# 数学动画分镜: ${concept}\n\n## 概念分析\n${conceptAnalysis}\n\n## 场景设计\n${conceptDesign}\n\n## 分镜脚本\n${storyboard.map((f) => `### 帧${f.frame}\n${f.description}`).join('\n\n')}`;

    const videoArtifacts: NonNullable<MathAnimatorResult['artifacts']> = videoArtifact?.url
      ? [{
          type: 'video' as const,
          url: videoArtifact.url,
          filename: videoArtifact.url.split('/').pop() || 'animation.mp4',
          content_type: videoArtifact.mimeType || 'video/mp4',
          label: 'Video Output',
        }]
      : [];

    const result: MathAnimatorResult = {
      success: true,
      response,
      output_mode: outputFormat === 'video' ? 'video' : 'image',
      outputUrl: videoArtifact?.url,
      storyboard: storyboard.length > 0 ? storyboard : undefined,
      manimCode: outputFormat === 'video' ? manimCode : undefined,
      code: {
        language: 'python',
        content: outputFormat === 'video' ? manimCode : '',
      },
      artifacts: videoArtifacts,
      timings: {},
      render: {
        quality: 'low',
        retry_attempts: retryHistory.length,
        retry_history: retryHistory,
        renderError,
      },
      ...(audioArtifact || renderError || ttsError
        ? {
            toolArtifacts: {
              video: videoArtifact,
              audio: audioArtifact,
              renderError,
              ttsError,
            },
          } as unknown as Partial<MathAnimatorResult>
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
