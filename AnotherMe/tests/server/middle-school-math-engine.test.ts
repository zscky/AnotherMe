import { describe, expect, it } from 'vitest';
import {
  analyzeMiddleSchoolMathRequirement,
  applyMathQualityRecovery,
  buildMathLessonPlan,
  compileMathLessonPlanToOutlines,
  runMathQualityGates,
} from '@/lib/server/course-engine';

describe('middle-school-math course engine', () => {
  it('infers grade band and key knowledge from free-form requirement', () => {
    const analysis = analyzeMiddleSchoolMathRequirement({
      requirement: '请按中考难度讲解二次函数，重点做变式题和易错点',
      language: 'zh-CN',
    });

    expect(analysis.gradeBand).toBe('grade9');
    expect(analysis.knowledgeNodes.some((node) => node.label.includes('二次函数'))).toBe(true);
    expect(analysis.preferredQuestionTypes).toContain('text');
  });

  it('compiles a deterministic ordered outline sequence from math lesson plan', () => {
    const analysis = analyzeMiddleSchoolMathRequirement({
      requirement: '讲解一次函数并安排课堂测验',
      language: 'zh-CN',
    });
    const plan = buildMathLessonPlan(analysis);
    const outlines = compileMathLessonPlanToOutlines(plan);

    expect(outlines.length).toBeGreaterThanOrEqual(6);
    expect(outlines[0].order).toBe(1);
    expect(outlines.at(-1)?.order).toBe(outlines.length);
    expect(outlines.filter((outline) => outline.type === 'quiz').length).toBeGreaterThanOrEqual(1);
    expect(plan.questionBlueprint.totalQuestions).toBeGreaterThanOrEqual(8);
    expect(plan.assessmentCheckpoints[0]?.blueprintItemIds.length).toBeGreaterThan(0);
  });

  it('builds prerequisite closure by synthesizing missing prerequisite nodes', () => {
    const analysis = analyzeMiddleSchoolMathRequirement({
      requirement: '讲解一次函数的图像性质',
      language: 'zh-CN',
    });
    const plan = buildMathLessonPlan(analysis);

    expect(plan.prerequisiteClosure.requiredLabels).toContain('一元一次方程');
    expect(plan.prerequisiteClosure.satisfied).toBe(true);
    expect(plan.knowledgeGraph.some((node) => node.label === '一元一次方程')).toBe(true);
  });

  it('flags quiz density failure and returns targeted recovery actions', () => {
    const analysis = analyzeMiddleSchoolMathRequirement({
      requirement: '初二全等三角形专题复习',
      language: 'zh-CN',
      pedagogyProfile: { strictness: 'high' },
    });
    const plan = buildMathLessonPlan(analysis);
    const outlinesWithoutQuiz = compileMathLessonPlanToOutlines(plan).map((outline) =>
      outline.type === 'quiz' ? { ...outline, type: 'slide' as const } : outline,
    );
    const report = runMathQualityGates({
      analysis,
      plan,
      outlines: outlinesWithoutQuiz,
    });

    expect(report.failedChecks.some((check) => check.name === 'quiz_density')).toBe(true);
    expect(report.targetedFixes.some((fix) => fix.strategy === 'rebalance_question_blueprint')).toBe(
      true,
    );

    const recoveredPlan = applyMathQualityRecovery(plan, report);
    const recoveredOutlines = compileMathLessonPlanToOutlines(recoveredPlan);
    expect(recoveredOutlines.filter((outline) => outline.type === 'quiz').length).toBeGreaterThan(
      0,
    );
    const rerunReport = runMathQualityGates({
      analysis,
      plan: recoveredPlan,
      outlines: recoveredOutlines,
    });
    expect(rerunReport.score).toBeGreaterThanOrEqual(report.score);
  });
});
