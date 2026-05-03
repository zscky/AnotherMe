import { nanoid } from 'nanoid';
import type { SceneOutline } from '@/lib/types/generation';
import type { AssessmentCheckpoint, LessonPlanSegment, MathLessonPlan } from './types';

function joinKeyPoints(points: string[]) {
  return points.filter(Boolean).slice(0, 5).map((item) => item.trim()).filter(Boolean);
}

function checkpointForSegment(
  segment: LessonPlanSegment,
  checkpoints: AssessmentCheckpoint[],
): AssessmentCheckpoint | undefined {
  if (segment.stage === 'variant_practice') return checkpoints[0];
  if (segment.stage === 'summary_closure') return checkpoints[1] || checkpoints[0];
  return undefined;
}

function mergeQuizDifficulty(
  levels: Array<'easy' | 'medium' | 'hard'>,
): 'easy' | 'medium' | 'hard' {
  if (levels.includes('hard')) return 'hard';
  if (levels.includes('medium')) return 'medium';
  return 'easy';
}

function toSceneOutline(
  segment: LessonPlanSegment,
  plan: MathLessonPlan,
  order: number,
): SceneOutline {
  const focusKnowledge = segment.focusKnowledgeIds
    .map((id) => plan.knowledgeGraph.find((item) => item.id === id)?.label)
    .filter((item): item is string => Boolean(item));
  const checkpoint = checkpointForSegment(segment, plan.assessmentCheckpoints);
  const blueprintItems = checkpoint
    ? plan.questionBlueprint.items.filter((item) => checkpoint.blueprintItemIds.includes(item.id))
    : [];
  const blueprintSummary =
    blueprintItems.length > 0
      ? plan.language === 'zh-CN'
        ? `题目蓝图：${blueprintItems
            .map((item) => `${item.category}/${item.questionType}/${item.difficulty}`)
            .join(' | ')}`
        : `Question blueprint: ${blueprintItems
            .map((item) => `${item.category}/${item.questionType}/${item.difficulty}`)
            .join(' | ')}`
      : '';

  const basePoints = joinKeyPoints(
    [
      ...focusKnowledge.map((item) =>
        plan.language === 'zh-CN' ? `知识点：${item}` : `Knowledge: ${item}`,
      ),
      plan.language === 'zh-CN'
        ? `难度层级：${segment.difficulty}`
        : `Difficulty level: ${segment.difficulty}`,
      ...segment.misconceptionTags.map((tag) =>
        plan.language === 'zh-CN' ? `易错提醒：${tag}` : `Misconception: ${tag}`,
      ),
      blueprintSummary,
    ],
  );

  const outline: SceneOutline = {
    id: `scene_${nanoid(8)}`,
    type: segment.preferredSceneType,
    title: segment.title,
    description: segment.objective,
    keyPoints: basePoints,
    teachingObjective: segment.objective,
    estimatedDuration: segment.estimatedDurationSec,
    order,
    language: plan.language,
  };

  if (segment.preferredSceneType === 'quiz') {
    const blueprintQuestionTypes =
      blueprintItems.length > 0
        ? Array.from(new Set(blueprintItems.map((item) => item.questionType)))
        : checkpoint?.questionTypes || ['single', 'text'];
    const blueprintDifficulty =
      blueprintItems.length > 0
        ? mergeQuizDifficulty(blueprintItems.map((item) => item.difficulty))
        : checkpoint?.difficulty || segment.difficulty;

    outline.quizConfig = {
      questionCount: Math.max(
        plan.profile.strictness === 'high' ? 3 : 2,
        checkpoint?.blueprintItemIds.length || 0,
      ),
      difficulty: blueprintDifficulty,
      questionTypes: blueprintQuestionTypes,
    };
  }

  if (segment.preferredSceneType === 'interactive') {
    outline.interactiveConfig = {
      conceptName: focusKnowledge[0] || plan.topic,
      conceptOverview: segment.objective,
      designIdea:
        plan.language === 'zh-CN'
          ? '通过参数拖动与图形变化展示概念，强调量与形的联动'
          : 'Use sliders and visual transitions to reveal concept dynamics',
      subject: plan.language === 'zh-CN' ? '初中数学' : 'Middle School Math',
    };
  }

  return outline;
}

export function compileMathLessonPlanToOutlines(plan: MathLessonPlan): SceneOutline[] {
  return plan.segments.map((segment, index) => toSceneOutline(segment, plan, index + 1));
}
