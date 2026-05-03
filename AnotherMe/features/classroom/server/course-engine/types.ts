import type { SceneOutline } from '@/lib/types/generation';
import type { LearningContext } from '@/lib/types/learning-context';

export type GradeBand = 'grade7' | 'grade8' | 'grade9' | 'auto';
export type StrictnessLevel = 'standard' | 'high';
export type DifficultyLevel = 'easy' | 'medium' | 'hard';
export type QuestionType = 'single' | 'multiple' | 'text';
export type BlueprintCategory = 'foundation' | 'method' | 'application' | 'exam_challenge';

export interface PedagogyProfileInput {
  domain?: 'middle-school-math';
  exam_orientation?: 'zhongkao';
  grade_band?: GradeBand;
  strictness?: StrictnessLevel;
}

export interface PedagogyProfile {
  domain: 'middle-school-math';
  examOrientation: 'zhongkao';
  gradeBand: Exclude<GradeBand, 'auto'>;
  strictness: StrictnessLevel;
}

export interface KnowledgeNode {
  id: string;
  label: string;
  module: string;
  difficulty: DifficultyLevel;
  prerequisites: string[];
}

export type MisconceptionTag =
  | 'symbol_confusion'
  | 'condition_omission'
  | 'formula_misuse'
  | 'reasoning_jump'
  | 'diagram_misread';

export interface AssessmentCheckpoint {
  id: string;
  title: string;
  difficulty: DifficultyLevel;
  questionTypes: QuestionType[];
  targetKnowledgeIds: string[];
  blueprintItemIds: string[];
}

export interface RequirementAnalysis {
  topic: string;
  language: 'zh-CN' | 'en-US';
  gradeBand: Exclude<GradeBand, 'auto'>;
  profile: PedagogyProfile;
  isMathClass: boolean;
  knowledgeNodes: KnowledgeNode[];
  misconceptions: MisconceptionTag[];
  skillTargets: string[];
  preferredQuestionTypes: QuestionType[];
  prerequisiteHints: string[];
  difficultyCurve: DifficultyLevel[];
  analysisTrace: string[];
}

export interface LessonPlanSegment {
  id: string;
  stage:
    | 'diagnostic_intro'
    | 'concept_method'
    | 'worked_example'
    | 'variant_practice'
    | 'misconception_review'
    | 'summary_closure';
  title: string;
  objective: string;
  focusKnowledgeIds: string[];
  misconceptionTags: MisconceptionTag[];
  preferredSceneType: SceneOutline['type'];
  difficulty: DifficultyLevel;
  estimatedDurationSec: number;
}

export interface MathLessonPlan {
  planId: string;
  topic: string;
  language: 'zh-CN' | 'en-US';
  gradeBand: Exclude<GradeBand, 'auto'>;
  profile: PedagogyProfile;
  knowledgeGraph: KnowledgeNode[];
  prerequisiteClosure: {
    requiredLabels: string[];
    missingLabels: string[];
    synthesizedNodeIds: string[];
    satisfied: boolean;
  };
  questionBlueprint: {
    examOrientation: 'zhongkao';
    distribution: Record<BlueprintCategory, number>;
    totalQuestions: number;
    items: Array<{
      id: string;
      category: BlueprintCategory;
      stage: LessonPlanSegment['stage'];
      targetKnowledgeIds: string[];
      questionType: QuestionType;
      difficulty: DifficultyLevel;
      rationale: string;
    }>;
  };
  assessmentCheckpoints: AssessmentCheckpoint[];
  segments: LessonPlanSegment[];
  createdAt: string;
}

export interface QualityGateCheck {
  name:
    | 'knowledge_coverage'
    | 'prerequisite_closure'
    | 'prerequisite_alignment'
    | 'difficulty_progression'
    | 'quiz_density'
    | 'misconception_coverage'
    | 'exam_blueprint_alignment';
  passed: boolean;
  score: number;
  details: string;
}

export interface QualityGateFixAction {
  checkName: QualityGateCheck['name'];
  strategy:
    | 'inject_prerequisite_bridge'
    | 'rebalance_question_blueprint'
    | 'smooth_difficulty_curve'
    | 'strengthen_misconception_coverage';
  prompt: string;
}

export interface QualityGateReport {
  passed: boolean;
  score: number;
  checks: QualityGateCheck[];
  failedChecks: QualityGateCheck[];
  failureReasons: string[];
  targetedFixes: QualityGateFixAction[];
}

export interface CourseGenerationAttempt {
  attempt: number;
  quality: QualityGateReport;
  outlinesCount: number;
  recovered: boolean;
}

export interface CourseGenerationMeta {
  engineVersion: string;
  engineProvider: 'legacy' | 'msm_v1';
  pedagogyProfile: PedagogyProfile;
  requirementAnalysis: RequirementAnalysis;
  lessonPlanSummary: {
    planId: string;
    segmentCount: number;
    checkpointCount: number;
  };
  qualityReport: QualityGateReport;
  attempts: CourseGenerationAttempt[];
  learningContext?: LearningContext;
}
