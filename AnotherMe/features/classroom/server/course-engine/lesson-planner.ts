import { nanoid } from 'nanoid';
import type {
  AssessmentCheckpoint,
  BlueprintCategory,
  DifficultyLevel,
  LessonPlanSegment,
  MathLessonPlan,
  QuestionType,
  RequirementAnalysis,
} from './types';

function pickDifficulty(curve: DifficultyLevel[], index: number): DifficultyLevel {
  return curve[Math.min(index, curve.length - 1)] || 'medium';
}

function pickQuestionType(
  category: BlueprintCategory,
  preferredTypes: QuestionType[],
): QuestionType {
  if (category === 'foundation') return preferredTypes.includes('single') ? 'single' : 'text';
  if (category === 'method') {
    if (preferredTypes.includes('multiple')) return 'multiple';
    if (preferredTypes.includes('single')) return 'single';
    return 'text';
  }
  if (category === 'application') return preferredTypes.includes('text') ? 'text' : 'multiple';
  return preferredTypes.includes('text') ? 'text' : 'multiple';
}

function allocateDistribution(
  total: number,
  strictness: 'standard' | 'high',
): Record<BlueprintCategory, number> {
  const weights: Record<BlueprintCategory, number> =
    strictness === 'high'
      ? { foundation: 0.2, method: 0.3, application: 0.25, exam_challenge: 0.25 }
      : { foundation: 0.3, method: 0.3, application: 0.25, exam_challenge: 0.15 };

  const categories: BlueprintCategory[] = ['foundation', 'method', 'application', 'exam_challenge'];
  const base = categories.reduce<Record<BlueprintCategory, number>>(
    (acc, category) => ({
      ...acc,
      [category]: Math.floor(total * weights[category]),
    }),
    { foundation: 0, method: 0, application: 0, exam_challenge: 0 },
  );

  base.exam_challenge = Math.max(base.exam_challenge, 1);
  let used = base.foundation + base.method + base.application + base.exam_challenge;
  const priority: BlueprintCategory[] =
    strictness === 'high'
      ? ['exam_challenge', 'application', 'method', 'foundation']
      : ['foundation', 'method', 'application', 'exam_challenge'];
  let pointer = 0;
  while (used < total) {
    const category = priority[pointer % priority.length];
    base[category] += 1;
    used += 1;
    pointer += 1;
  }
  while (used > total) {
    const category = priority[pointer % priority.length];
    if (base[category] > 1 || category !== 'exam_challenge') {
      base[category] -= 1;
      used -= 1;
    }
    pointer += 1;
  }
  return base;
}

function buildQuestionBlueprint(
  analysis: RequirementAnalysis,
  knowledgeGraph: MathLessonPlan['knowledgeGraph'],
): MathLessonPlan['questionBlueprint'] {
  const coreIds = analysis.knowledgeNodes.map((node) => node.id);
  const prerequisiteIds = knowledgeGraph
    .filter((node) => !coreIds.includes(node.id))
    .map((node) => node.id);
  const midIndex = Math.max(1, Math.floor(coreIds.length / 2));
  const first = coreIds.slice(0, 1);
  const mid = coreIds.slice(0, Math.max(2, midIndex));
  const tail = coreIds.slice(Math.max(0, coreIds.length - 2));
  const totalQuestions = analysis.profile.strictness === 'high' ? 10 : 8;
  const distribution = allocateDistribution(totalQuestions, analysis.profile.strictness);
  const stageByCategory: Record<BlueprintCategory, LessonPlanSegment['stage']> = {
    foundation: 'variant_practice',
    method: 'variant_practice',
    application: 'summary_closure',
    exam_challenge: 'summary_closure',
  };
  const targetKnowledgeByCategory: Record<BlueprintCategory, string[]> = {
    foundation: prerequisiteIds.length > 0 ? prerequisiteIds : first,
    method: mid.length > 0 ? mid : first,
    application: tail.length > 0 ? tail : mid,
    exam_challenge: tail.length > 0 ? tail : coreIds,
  };
  const difficultyByCategory: Record<BlueprintCategory, DifficultyLevel> = {
    foundation: 'easy',
    method: 'medium',
    application: 'medium',
    exam_challenge: 'hard',
  };
  const rationaleByCategory = (category: BlueprintCategory) => {
    if (analysis.language === 'zh-CN') {
      if (category === 'foundation') return '中考基础分题，强调定义与基本计算';
      if (category === 'method') return '中考常规方法题，强调步骤完整与方法选择';
      if (category === 'application') return '中考应用迁移题，强调模型转化与条件判断';
      return '中考压轴挑战题，强调综合推理与多步链路';
    }
    if (category === 'foundation') return 'Base-score item for definitions and core operations';
    if (category === 'method') return 'Method item for step completeness and strategy selection';
    if (category === 'application') return 'Transfer item for modeling and condition checks';
    return 'Challenge item for integrated multi-step reasoning';
  };

  const items: MathLessonPlan['questionBlueprint']['items'] = [];
  (['foundation', 'method', 'application', 'exam_challenge'] as BlueprintCategory[]).forEach(
    (category) => {
      for (let i = 0; i < distribution[category]; i += 1) {
        items.push({
          id: `qb_${nanoid(6)}`,
          category,
          stage: stageByCategory[category],
          targetKnowledgeIds: targetKnowledgeByCategory[category],
          questionType: pickQuestionType(category, analysis.preferredQuestionTypes),
          difficulty: difficultyByCategory[category],
          rationale: rationaleByCategory(category),
        });
      }
    },
  );

  return {
    examOrientation: 'zhongkao',
    distribution,
    totalQuestions,
    items,
  };
}

function buildAssessmentCheckpoints(
  analysis: RequirementAnalysis,
  questionBlueprint: MathLessonPlan['questionBlueprint'],
): AssessmentCheckpoint[] {
  const variantItems = questionBlueprint.items.filter((item) => item.stage === 'variant_practice');
  const summaryItems = questionBlueprint.items.filter((item) => item.stage === 'summary_closure');
  const closureItems = summaryItems.length > 0 ? summaryItems : variantItems;
  const checkpointFromItems = (
    title: string,
    fallbackDifficulty: DifficultyLevel,
    items: MathLessonPlan['questionBlueprint']['items'],
  ): AssessmentCheckpoint => {
    const hasHard = items.some((item) => item.difficulty === 'hard');
    const hasMedium = items.some((item) => item.difficulty === 'medium');
    const difficulty: DifficultyLevel = hasHard ? 'hard' : hasMedium ? 'medium' : fallbackDifficulty;
    return {
      id: `cp_${nanoid(6)}`,
      title,
      difficulty,
      questionTypes: Array.from(new Set(items.map((item) => item.questionType))),
      targetKnowledgeIds: Array.from(new Set(items.flatMap((item) => item.targetKnowledgeIds))),
      blueprintItemIds: items.map((item) => item.id),
    };
  };

  return [
    checkpointFromItems(
      analysis.language === 'zh-CN' ? '变式训练检测' : 'Variation Drill Checkpoint',
      'medium',
      variantItems,
    ),
    checkpointFromItems(
      analysis.language === 'zh-CN' ? '课堂总结检测' : 'Lesson Closure Checkpoint',
      'hard',
      closureItems,
    ),
  ];
}

function expandKnowledgeGraph(
  analysis: RequirementAnalysis,
): Pick<MathLessonPlan, 'knowledgeGraph' | 'prerequisiteClosure'> {
  const requiredLabels = Array.from(
    new Set(analysis.knowledgeNodes.flatMap((node) => node.prerequisites).filter(Boolean)),
  );
  const currentLabelSet = new Set(analysis.knowledgeNodes.map((node) => node.label));
  const missingBeforeSynthesis = requiredLabels.filter((label) => !currentLabelSet.has(label));
  const synthesizedNodes = missingBeforeSynthesis.map((label) => ({
    id: `kn_${nanoid(6)}`,
    label,
    module: 'prerequisite',
    difficulty: 'easy' as const,
    prerequisites: [],
  }));
  const mergedGraph = [...synthesizedNodes, ...analysis.knowledgeNodes];
  const mergedLabelSet = new Set(mergedGraph.map((node) => node.label));
  const missingLabels = requiredLabels.filter((label) => !mergedLabelSet.has(label));

  return {
    knowledgeGraph: mergedGraph,
    prerequisiteClosure: {
      requiredLabels,
      missingLabels,
      synthesizedNodeIds: synthesizedNodes.map((node) => node.id),
      satisfied: missingLabels.length === 0,
    },
  };
}

function buildSegments(
  analysis: RequirementAnalysis,
  knowledgeGraph: MathLessonPlan['knowledgeGraph'],
  prerequisiteClosure: MathLessonPlan['prerequisiteClosure'],
): LessonPlanSegment[] {
  const allKnowledgeIds = knowledgeGraph.map((node) => node.id);
  const coreKnowledgeIds = analysis.knowledgeNodes.map((node) => node.id);
  const prerequisiteKnowledgeIds = knowledgeGraph
    .filter((node) => prerequisiteClosure.requiredLabels.includes(node.label))
    .map((node) => node.id);
  const firstKnowledge = coreKnowledgeIds.slice(0, 1);
  const midKnowledge = coreKnowledgeIds.slice(0, Math.max(2, Math.ceil(coreKnowledgeIds.length / 2)));
  const tailKnowledge = coreKnowledgeIds.slice(Math.max(0, coreKnowledgeIds.length - 2));
  const diagnosticFocus = Array.from(
    new Set([
      ...prerequisiteKnowledgeIds,
      ...(firstKnowledge.length > 0 ? firstKnowledge : coreKnowledgeIds.slice(0, 2)),
    ]),
  );

  const interactiveSuggested = /函数|图像|几何|圆|三角形/.test(analysis.topic);
  const prerequisiteObjective =
    analysis.language === 'zh-CN'
      ? prerequisiteClosure.synthesizedNodeIds.length > 0
        ? `补齐先修：${prerequisiteClosure.requiredLabels.join('、')}`
        : '定位先修掌握情况，建立问题场景'
      : prerequisiteClosure.synthesizedNodeIds.length > 0
        ? `Bridge prerequisites: ${prerequisiteClosure.requiredLabels.join(', ')}`
        : 'Locate prerequisite gaps and set context';

  const base: Omit<LessonPlanSegment, 'id' | 'difficulty'>[] = [
    {
      stage: 'diagnostic_intro',
      title: analysis.language === 'zh-CN' ? '诊断导入' : 'Diagnostic Warm-up',
      objective: prerequisiteObjective,
      focusKnowledgeIds: diagnosticFocus,
      misconceptionTags: [],
      preferredSceneType: 'slide',
      estimatedDurationSec: 120,
    },
    {
      stage: 'concept_method',
      title: analysis.language === 'zh-CN' ? '概念与方法' : 'Concept and Method',
      objective:
        analysis.language === 'zh-CN'
          ? '明确概念定义、适用条件与核心方法'
          : 'Clarify definition, boundary conditions, and method',
      focusKnowledgeIds: midKnowledge,
      misconceptionTags: analysis.misconceptions.slice(0, 2),
      preferredSceneType: interactiveSuggested ? 'interactive' : 'slide',
      estimatedDurationSec: interactiveSuggested ? 180 : 150,
    },
    {
      stage: 'worked_example',
      title: analysis.language === 'zh-CN' ? '例题分步' : 'Worked Example',
      objective:
        analysis.language === 'zh-CN'
          ? '按照已知-求解-结论的链路展开演示'
          : 'Demonstrate known-solve-conclusion chain',
      focusKnowledgeIds: midKnowledge,
      misconceptionTags: analysis.misconceptions.slice(0, 2),
      preferredSceneType: 'slide',
      estimatedDurationSec: 180,
    },
    {
      stage: 'variant_practice',
      title: analysis.language === 'zh-CN' ? '变式训练' : 'Variation Practice',
      objective:
        analysis.language === 'zh-CN'
          ? '用分层题型训练迁移能力'
          : 'Train transfer ability with layered problems',
      focusKnowledgeIds: tailKnowledge.length > 0 ? tailKnowledge : midKnowledge,
      misconceptionTags: analysis.misconceptions.slice(0, 2),
      preferredSceneType: 'quiz',
      estimatedDurationSec: 150,
    },
    {
      stage: 'misconception_review',
      title: analysis.language === 'zh-CN' ? '易错复盘' : 'Misconception Review',
      objective:
        analysis.language === 'zh-CN'
          ? '对高频错因进行对照纠偏'
          : 'Review high-frequency mistakes and corrections',
      focusKnowledgeIds: tailKnowledge.length > 0 ? tailKnowledge : midKnowledge,
      misconceptionTags: analysis.misconceptions,
      preferredSceneType: 'slide',
      estimatedDurationSec: 120,
    },
    {
      stage: 'summary_closure',
      title: analysis.language === 'zh-CN' ? '课堂小结' : 'Summary and Closure',
      objective:
        analysis.language === 'zh-CN'
          ? '收束知识网络并布置下一步练习'
          : 'Close with knowledge map and next practice',
      focusKnowledgeIds: allKnowledgeIds,
      misconceptionTags: analysis.misconceptions.slice(0, 2),
      preferredSceneType: 'quiz',
      estimatedDurationSec: 120,
    },
  ];

  return base.map((segment, index) => ({
    ...segment,
    id: `seg_${nanoid(8)}`,
    difficulty: pickDifficulty(analysis.difficultyCurve, index),
  }));
}

export function buildMathLessonPlan(analysis: RequirementAnalysis): MathLessonPlan {
  const { knowledgeGraph, prerequisiteClosure } = expandKnowledgeGraph(analysis);
  const questionBlueprint = buildQuestionBlueprint(analysis, knowledgeGraph);
  return {
    planId: `plan_${nanoid(8)}`,
    topic: analysis.topic,
    language: analysis.language,
    gradeBand: analysis.gradeBand,
    profile: analysis.profile,
    knowledgeGraph,
    prerequisiteClosure,
    questionBlueprint,
    assessmentCheckpoints: buildAssessmentCheckpoints(analysis, questionBlueprint),
    segments: buildSegments(analysis, knowledgeGraph, prerequisiteClosure),
    createdAt: new Date().toISOString(),
  };
}
