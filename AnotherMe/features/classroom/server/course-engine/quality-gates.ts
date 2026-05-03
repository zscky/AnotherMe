import { nanoid } from 'nanoid';
import type { SceneOutline } from '@/lib/types/generation';
import type {
  DifficultyLevel,
  LessonPlanSegment,
  MathLessonPlan,
  QualityGateCheck,
  QualityGateFixAction,
  QualityGateReport,
  RequirementAnalysis,
} from './types';

function difficultyWeight(level: DifficultyLevel): number {
  if (level === 'easy') return 1;
  if (level === 'medium') return 2;
  return 3;
}

function buildCheck(
  name: QualityGateCheck['name'],
  passed: boolean,
  score: number,
  details: string,
): QualityGateCheck {
  return {
    name,
    passed,
    score: Math.max(0, Math.min(100, score)),
    details,
  };
}

function checkKnowledgeCoverage(plan: MathLessonPlan, outlines: SceneOutline[]): QualityGateCheck {
  const text = outlines.flatMap((outline) => [outline.title, outline.description, ...outline.keyPoints]).join(' ');
  const covered = plan.knowledgeGraph.filter((node) => text.includes(node.label)).length;
  const ratio = plan.knowledgeGraph.length > 0 ? covered / plan.knowledgeGraph.length : 1;
  return buildCheck(
    'knowledge_coverage',
    ratio >= 0.7,
    Math.round(ratio * 100),
    `covered=${covered}/${plan.knowledgeGraph.length}`,
  );
}

function checkPrerequisiteClosure(plan: MathLessonPlan): QualityGateCheck {
  const missingCount = plan.prerequisiteClosure.missingLabels.length;
  if (missingCount === 0) {
    return buildCheck('prerequisite_closure', true, 100, 'closure_complete');
  }
  const score = Math.max(0, 100 - missingCount * 30);
  return buildCheck(
    'prerequisite_closure',
    false,
    score,
    `missing=${plan.prerequisiteClosure.missingLabels.join('|')}`,
  );
}

function checkPrerequisiteAlignment(
  analysis: RequirementAnalysis,
  plan: MathLessonPlan,
  outlines: SceneOutline[],
): QualityGateCheck {
  const prerequisiteHints = Array.from(
    new Set([...analysis.prerequisiteHints, ...plan.prerequisiteClosure.requiredLabels]),
  );
  if (prerequisiteHints.length === 0) {
    return buildCheck('prerequisite_alignment', true, 100, 'no_prerequisite_hints');
  }
  const introText = outlines
    .slice(0, Math.min(2, outlines.length))
    .flatMap((outline) => [outline.title, outline.description, ...outline.keyPoints])
    .join(' ');
  const hit = prerequisiteHints.filter((hint) => introText.includes(hint)).length;
  const ratio = hit / prerequisiteHints.length;
  return buildCheck(
    'prerequisite_alignment',
    ratio >= 0.6,
    Math.round(ratio * 100),
    `hit=${hit}/${prerequisiteHints.length}`,
  );
}

function checkDifficultyProgression(plan: MathLessonPlan): QualityGateCheck {
  const weights = plan.segments.map((segment) => difficultyWeight(segment.difficulty));
  let inversions = 0;
  for (let i = 1; i < weights.length; i += 1) {
    if (weights[i] + 1 < weights[i - 1]) inversions += 1;
  }
  const score = Math.max(0, 100 - inversions * 25);
  return buildCheck(
    'difficulty_progression',
    inversions <= 1,
    score,
    `inversions=${inversions};curve=${weights.join('>')}`,
  );
}

function checkQuizDensity(outlines: SceneOutline[]): QualityGateCheck {
  const quizCount = outlines.filter((outline) => outline.type === 'quiz').length;
  const minimumQuiz = Math.max(2, Math.ceil(outlines.length / 4));
  const ratio = minimumQuiz === 0 ? 1 : Math.min(1, quizCount / minimumQuiz);
  return buildCheck(
    'quiz_density',
    quizCount >= minimumQuiz,
    Math.round(ratio * 100),
    `quiz=${quizCount},required=${minimumQuiz}`,
  );
}

function checkMisconceptionCoverage(
  analysis: RequirementAnalysis,
  outlines: SceneOutline[],
): QualityGateCheck {
  if (analysis.misconceptions.length === 0) {
    return buildCheck('misconception_coverage', true, 100, 'no_misconceptions');
  }
  const text = outlines.flatMap((outline) => [outline.description, ...outline.keyPoints]).join(' ');
  const covered = analysis.misconceptions.filter((tag) => text.includes(tag)).length;
  const ratio = covered / analysis.misconceptions.length;
  return buildCheck(
    'misconception_coverage',
    ratio >= 0.5,
    Math.round(ratio * 100),
    `covered=${covered}/${analysis.misconceptions.length}`,
  );
}

function checkExamBlueprintAlignment(
  plan: MathLessonPlan,
  outlines: SceneOutline[],
): QualityGateCheck {
  const quizOutlines = outlines.filter((outline) => outline.type === 'quiz');
  if (quizOutlines.length === 0) {
    return buildCheck('exam_blueprint_alignment', false, 0, 'no_quiz_outline');
  }

  const expectedTotal = plan.questionBlueprint.totalQuestions;
  const actualTotal = quizOutlines.reduce(
    (sum, outline) => sum + Math.max(0, outline.quizConfig?.questionCount || 0),
    0,
  );
  const totalRatio = expectedTotal > 0 ? Math.min(1, actualTotal / expectedTotal) : 1;
  const needsHard = plan.questionBlueprint.distribution.exam_challenge > 0;
  const hasHardQuiz = quizOutlines.some((outline) => outline.quizConfig?.difficulty === 'hard');
  const score = Math.round(totalRatio * 80 + (hasHardQuiz || !needsHard ? 20 : 0));
  const passed = totalRatio >= 0.85 && (hasHardQuiz || !needsHard);

  return buildCheck(
    'exam_blueprint_alignment',
    passed,
    score,
    `expected=${expectedTotal},actual=${actualTotal},need_hard=${needsHard ? 'yes' : 'no'},has_hard=${hasHardQuiz ? 'yes' : 'no'}`,
  );
}

function buildTargetedFixes(
  analysis: RequirementAnalysis,
  failedChecks: QualityGateCheck[],
): QualityGateFixAction[] {
  return failedChecks.map((check) => {
    if (check.name === 'prerequisite_closure' || check.name === 'prerequisite_alignment') {
      return {
        checkName: check.name,
        strategy: 'inject_prerequisite_bridge',
        prompt:
          analysis.language === 'zh-CN'
            ? '在诊断导入中补齐先修桥接题，显式讲清先修知识与本课知识的连接关系。'
            : 'Inject prerequisite bridge prompts in diagnostic intro and make the dependency explicit.',
      };
    }
    if (check.name === 'quiz_density' || check.name === 'exam_blueprint_alignment') {
      return {
        checkName: check.name,
        strategy: 'rebalance_question_blueprint',
        prompt:
          analysis.language === 'zh-CN'
            ? '按中考蓝图重排题目配比，保证测验密度、压轴题与题型覆盖。'
            : 'Rebalance the exam-oriented question blueprint to restore quiz density and challenge coverage.',
      };
    }
    if (check.name === 'difficulty_progression') {
      return {
        checkName: check.name,
        strategy: 'smooth_difficulty_curve',
        prompt:
          analysis.language === 'zh-CN'
            ? '重排难度梯度，保证从基础到综合的逐级爬坡。'
            : 'Smooth the difficulty curve from fundamentals to synthesis.',
      };
    }
    return {
      checkName: check.name,
      strategy: 'strengthen_misconception_coverage',
      prompt:
        analysis.language === 'zh-CN'
          ? '补充错因对照与知识覆盖提示，提升诊断和复盘强度。'
          : 'Strengthen misconception and concept coverage through explicit review prompts.',
    };
  });
}

function buildFailureReason(check: QualityGateCheck, language: 'zh-CN' | 'en-US'): string {
  if (language === 'zh-CN') {
    if (check.name === 'prerequisite_closure') return `先修闭包未满足：${check.details}`;
    if (check.name === 'exam_blueprint_alignment') return `题目蓝图未对齐：${check.details}`;
    if (check.name === 'quiz_density') return `测验密度不足：${check.details}`;
    if (check.name === 'difficulty_progression') return `难度爬坡异常：${check.details}`;
    if (check.name === 'knowledge_coverage') return `知识点覆盖不足：${check.details}`;
    if (check.name === 'misconception_coverage') return `易错点覆盖不足：${check.details}`;
    return `先修对齐不足：${check.details}`;
  }

  return `${check.name}: ${check.details}`;
}

export function runMathQualityGates(params: {
  analysis: RequirementAnalysis;
  plan: MathLessonPlan;
  outlines: SceneOutline[];
}): QualityGateReport {
  const checks = [
    checkKnowledgeCoverage(params.plan, params.outlines),
    checkPrerequisiteClosure(params.plan),
    checkPrerequisiteAlignment(params.analysis, params.plan, params.outlines),
    checkDifficultyProgression(params.plan),
    checkQuizDensity(params.outlines),
    checkMisconceptionCoverage(params.analysis, params.outlines),
    checkExamBlueprintAlignment(params.plan, params.outlines),
  ];
  const scoreWeights: Record<QualityGateCheck['name'], number> = {
    knowledge_coverage: 1,
    prerequisite_closure: 1.5,
    prerequisite_alignment: 1.2,
    difficulty_progression: 1,
    quiz_density: 1,
    misconception_coverage: 1,
    exam_blueprint_alignment: 1.5,
  };
  const weighted = checks.reduce(
    (sum, check) => sum + check.score * scoreWeights[check.name],
    0,
  );
  const totalWeight = checks.reduce((sum, check) => sum + scoreWeights[check.name], 0);
  const score = Math.round(weighted / Math.max(1, totalWeight));
  const threshold = params.analysis.profile.strictness === 'high' ? 82 : 72;
  const failedChecks = checks.filter((check) => !check.passed);
  const criticalFailures = failedChecks.filter(
    (check) => check.name === 'prerequisite_closure' || check.name === 'exam_blueprint_alignment',
  );
  const targetedFixes = buildTargetedFixes(params.analysis, failedChecks);
  const failureReasons = failedChecks.map((check) =>
    buildFailureReason(check, params.analysis.language),
  );

  return {
    passed: score >= threshold && criticalFailures.length === 0 && failedChecks.length <= 2,
    score,
    checks,
    failedChecks,
    failureReasons,
    targetedFixes,
  };
}

function insertExtraQuizSegment(plan: MathLessonPlan): LessonPlanSegment[] {
  const extraQuiz: LessonPlanSegment = {
    id: `seg_${nanoid(8)}`,
    stage: 'variant_practice',
    title: plan.language === 'zh-CN' ? '补充测验' : 'Supplementary Quiz',
    objective:
      plan.language === 'zh-CN' ? '按中考蓝图补足题型密度与迁移强度' : 'Fill blueprint gaps and raise transfer robustness',
    focusKnowledgeIds: plan.knowledgeGraph.slice(-2).map((item) => item.id),
    misconceptionTags: [],
    preferredSceneType: 'quiz',
    difficulty: 'medium',
    estimatedDurationSec: 120,
  };
  const index = Math.max(1, plan.segments.length - 1);
  return [...plan.segments.slice(0, index), extraQuiz, ...plan.segments.slice(index)];
}

function rebuildCheckpointsFromBlueprint(plan: MathLessonPlan): MathLessonPlan['assessmentCheckpoints'] {
  const variantItems = plan.questionBlueprint.items.filter((item) => item.stage === 'variant_practice');
  const summaryItems = plan.questionBlueprint.items.filter((item) => item.stage === 'summary_closure');
  const closureItems = summaryItems.length > 0 ? summaryItems : variantItems;
  const toCheckpoint = (
    id: string,
    title: string,
    items: MathLessonPlan['questionBlueprint']['items'],
    fallbackDifficulty: DifficultyLevel,
  ) => ({
    id,
    title,
    difficulty: items.some((item) => item.difficulty === 'hard')
      ? 'hard'
      : items.some((item) => item.difficulty === 'medium')
        ? 'medium'
        : fallbackDifficulty,
    questionTypes: Array.from(new Set(items.map((item) => item.questionType))),
    targetKnowledgeIds: Array.from(new Set(items.flatMap((item) => item.targetKnowledgeIds))),
    blueprintItemIds: items.map((item) => item.id),
  });

  return [
    toCheckpoint(
      `cp_${nanoid(6)}`,
      plan.language === 'zh-CN' ? '变式训练检测' : 'Variation Drill Checkpoint',
      variantItems,
      'medium',
    ),
    toCheckpoint(
      `cp_${nanoid(6)}`,
      plan.language === 'zh-CN' ? '课堂总结检测' : 'Lesson Closure Checkpoint',
      closureItems,
      'hard',
    ),
  ];
}

function injectPrerequisiteBridge(plan: MathLessonPlan): MathLessonPlan {
  const prerequisiteIds = plan.knowledgeGraph
    .filter((node) => plan.prerequisiteClosure.requiredLabels.includes(node.label))
    .map((node) => node.id);
  const prerequisiteLabels = plan.prerequisiteClosure.requiredLabels;
  const segments = plan.segments.map((segment) => {
    if (segment.stage !== 'diagnostic_intro') return segment;
    const bridgeObjective =
      plan.language === 'zh-CN'
        ? `先修桥接：${prerequisiteLabels.join('、') || '基础概念'}`
        : `Prerequisite bridge: ${prerequisiteLabels.join(', ') || 'core basics'}`;
    return {
      ...segment,
      objective: bridgeObjective,
      focusKnowledgeIds: Array.from(new Set([...prerequisiteIds, ...segment.focusKnowledgeIds])),
      estimatedDurationSec: Math.max(segment.estimatedDurationSec, 150),
    };
  });

  return {
    ...plan,
    segments,
    prerequisiteClosure: {
      ...plan.prerequisiteClosure,
      missingLabels: [],
      satisfied: true,
    },
  };
}

function rebalanceQuestionBlueprint(plan: MathLessonPlan): MathLessonPlan {
  let nextPlan = { ...plan, segments: [...plan.segments] };
  const quizSegments = nextPlan.segments.filter((segment) => segment.preferredSceneType === 'quiz');
  if (quizSegments.length < 2) {
    nextPlan = {
      ...nextPlan,
      segments: insertExtraQuizSegment(nextPlan),
    };
  }

  const quizStageSequence = nextPlan.segments
    .filter((segment) => segment.preferredSceneType === 'quiz')
    .map((segment) => segment.stage);
  if (quizStageSequence.length > 0) {
    const stageCount = quizStageSequence.length;
    nextPlan = {
      ...nextPlan,
      questionBlueprint: {
        ...nextPlan.questionBlueprint,
        items: nextPlan.questionBlueprint.items.map((item, index) => ({
          ...item,
          stage: quizStageSequence[index % stageCount] || item.stage,
        })),
      },
    };
  }

  const segments = nextPlan.segments.map((segment) => {
    if (segment.stage === 'summary_closure') {
      return {
        ...segment,
        difficulty: 'hard' as const,
      };
    }
    return segment;
  });

  return {
    ...nextPlan,
    segments,
    assessmentCheckpoints: rebuildCheckpointsFromBlueprint(nextPlan),
  };
}

function smoothDifficultyCurve(plan: MathLessonPlan): MathLessonPlan {
  const segments = plan.segments.map((segment, index) => {
    const mappedDifficulty: DifficultyLevel =
      index < 2 ? 'easy' : index < Math.max(3, plan.segments.length - 2) ? 'medium' : 'hard';
    return {
      ...segment,
      difficulty: mappedDifficulty,
    };
  });
  return {
    ...plan,
    segments,
  };
}

function strengthenMisconceptionCoverage(plan: MathLessonPlan): MathLessonPlan {
  const allKnowledgeIds = plan.knowledgeGraph.map((node) => node.id);
  const allMisconceptions = Array.from(
    new Set(plan.segments.flatMap((segment) => segment.misconceptionTags)),
  );

  const segments = plan.segments.map((segment) => {
    if (segment.stage === 'misconception_review' || segment.stage === 'summary_closure') {
      return {
        ...segment,
        misconceptionTags: allMisconceptions,
        focusKnowledgeIds: allKnowledgeIds,
      };
    }
    return segment;
  });

  return {
    ...plan,
    segments,
  };
}

export function applyMathQualityRecovery(plan: MathLessonPlan, report: QualityGateReport): MathLessonPlan {
  let recovered = {
    ...plan,
    segments: [...plan.segments],
    questionBlueprint: {
      ...plan.questionBlueprint,
      items: [...plan.questionBlueprint.items],
    },
    assessmentCheckpoints: [...plan.assessmentCheckpoints],
  };

  report.targetedFixes.forEach((fix) => {
    if (fix.strategy === 'inject_prerequisite_bridge') {
      recovered = injectPrerequisiteBridge(recovered);
      return;
    }
    if (fix.strategy === 'rebalance_question_blueprint') {
      recovered = rebalanceQuestionBlueprint(recovered);
      return;
    }
    if (fix.strategy === 'smooth_difficulty_curve') {
      recovered = smoothDifficultyCurve(recovered);
      return;
    }
    recovered = strengthenMisconceptionCoverage(recovered);
  });

  return recovered;
}
