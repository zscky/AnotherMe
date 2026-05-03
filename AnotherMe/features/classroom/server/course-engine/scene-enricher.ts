import type { SceneOutline } from '@/lib/types/generation';
import type { MathLessonPlan, RequirementAnalysis } from './types';

const BASE_MATH_CONSTRAINTS_ZH = [
  '公式规范：先定义符号，再写公式',
  '推理链：已知 → 方法选择 → 计算/证明 → 结论',
  '表达要求：结论需带条件和单位（如适用）',
];

const BASE_MATH_CONSTRAINTS_EN = [
  'Formula style: define symbols before equations',
  'Reasoning chain: knowns -> method -> derivation -> conclusion',
  'Expression rule: conclusions must carry conditions/units when applicable',
];

function translateMisconception(tag: string, language: 'zh-CN' | 'en-US') {
  if (language !== 'zh-CN') return tag;
  const mapping: Record<string, string> = {
    symbol_confusion: '符号混淆',
    condition_omission: '条件遗漏',
    formula_misuse: '公式误用',
    reasoning_jump: '推理跳步',
    diagram_misread: '图形误读',
  };
  return mapping[tag] || tag;
}

export function enrichOutlineForMiddleSchoolMath(params: {
  outline: SceneOutline;
  analysis: RequirementAnalysis;
  plan: MathLessonPlan;
  index: number;
}): SceneOutline {
  const { outline, analysis, index } = params;
  const constraints =
    analysis.language === 'zh-CN' ? BASE_MATH_CONSTRAINTS_ZH : BASE_MATH_CONSTRAINTS_EN;
  const stageDifficulty = analysis.difficultyCurve[Math.min(index, analysis.difficultyCurve.length - 1)];
  const misconceptionHints = analysis.misconceptions
    .slice(0, 2)
    .map((tag) =>
      analysis.language === 'zh-CN'
        ? `错因对照：${translateMisconception(tag, analysis.language)}`
        : `Misconception guard: ${translateMisconception(tag, analysis.language)}`,
    );

  const enrichedKeyPoints = Array.from(
    new Set([
      ...outline.keyPoints,
      ...constraints,
      ...misconceptionHints,
      analysis.language === 'zh-CN'
        ? `难度梯度定位：${stageDifficulty}`
        : `Difficulty position: ${stageDifficulty}`,
    ]),
  ).slice(0, 8);

  return {
    ...outline,
    keyPoints: enrichedKeyPoints,
  };
}

export function buildSceneMathGuidance(params: {
  analysis: RequirementAnalysis;
  sceneOrder: number;
  totalScenes: number;
}): string {
  const { analysis, sceneOrder, totalScenes } = params;
  if (analysis.language === 'zh-CN') {
    return [
      '[初中数学教学增强指令]',
      `当前进度：第 ${sceneOrder}/${totalScenes} 场景`,
      '讲解节奏：先结论，再给步骤化解释。',
      '过程要求：显式指出本题核心公式、条件、推理链。',
      `重点错因：${analysis.misconceptions.map((tag) => translateMisconception(tag, 'zh-CN')).join('、')}`,
      '互动要求：至少提出一个追问，确认学生是否真正理解。',
    ].join('\n');
  }
  return [
    '[Middle-School Math Enrichment]',
    `Progress: scene ${sceneOrder}/${totalScenes}`,
    'Speak with conclusion-first pacing, then explain steps.',
    'State formula, conditions, and reasoning chain explicitly.',
    `Focus misconceptions: ${analysis.misconceptions.join(', ')}`,
    'End with one probing check question.',
  ].join('\n');
}
