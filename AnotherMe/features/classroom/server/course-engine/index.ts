export type {
  PedagogyProfileInput,
  PedagogyProfile,
  RequirementAnalysis,
  MathLessonPlan,
  QualityGateReport,
  CourseGenerationMeta,
  CourseGenerationAttempt,
} from './types';

export { analyzeMiddleSchoolMathRequirement, normalizePedagogyProfile } from './requirement-analyzer';
export { buildMathLessonPlan } from './lesson-planner';
export { compileMathLessonPlanToOutlines } from './outline-compiler';
export { enrichOutlineForMiddleSchoolMath, buildSceneMathGuidance } from './scene-enricher';
export { runMathQualityGates, applyMathQualityRecovery } from './quality-gates';
