/**
 * Knowledge Tracing types - Bayesian Knowledge Tracing (BKT) state and
 * teaching decision types for the strict knowledge tracing layer.
 *
 * Architecture:
 *   LearningEvent → Q-matrix → BKT update → Mastery State → Teaching Policy → Prompt/Agent Context
 */

export type TeachingAction =
  | 'reteach'
  | 'give_hint'
  | 'worked_example'
  | 'variant_practice'
  | 'advance'
  | 'review_later';

export interface KnowledgePoint {
  id: string;
  subject?: string | null;
  name: string;
  description?: string | null;
  parentId?: string | null;
  prerequisites: string[];
  difficulty?: 'easy' | 'medium' | 'hard' | null;
  createdAt: string;
}

export interface QuestionKnowledgeMapping {
  questionId: string;
  knowledgePointId: string;
  weight: number;
  difficulty?: 'easy' | 'medium' | 'hard' | null;
}

export interface QuestionKnowledgeMap {
  questionId: string;
  knowledgePointIds: string[];
  weights?: Record<string, number>;
  difficulty?: 'easy' | 'medium' | 'hard' | null;
}

export interface StudentKnowledgeState {
  userId: string;
  knowledgePointId: string;
  pMastery: number;
  pLearn: number;
  pGuess: number;
  pSlip: number;
  attempts: number;
  correctAttempts: number;
  lastUpdatedAt?: string | null;
}

export interface QuizAnswerResult {
  knowledgePointId: string;
  priorMastery: number;
  posteriorMastery: number;
  attempts: number;
  correctAttempts: number;
  weight?: number;
  difficulty?: 'easy' | 'medium' | 'hard' | null;
}

export interface LearningEventQuestionAttemptPayload {
  questionId: string;
  isCorrect: boolean;
  answer?: string;
  correctAnswer?: string;
  attempts: number;
  durationMs: number;
  hintsUsed: number;
  knowledgePointIds: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface TeachingDecision {
  targetKnowledgePointId: string;
  mastery: number;
  action: TeachingAction;
  reason: string;
}

export interface KnowledgeTraceEvent {
  traceEventId: string;
  userId: string;
  knowledgePointId: string;
  sourceEventId?: string | null;
  eventType: string;
  priorMastery: number;
  posteriorMastery: number;
  isCorrect?: boolean | null;
  questionId?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
}

export interface KnowledgeTracingSummary {
  knowledgePointId: string;
  pMastery: number;
  attempts: number;
  correctAttempts: number;
  action?: string | null;
  actionReason?: string | null;
}

export interface StudentKnowledgeContext {
  contextText: string;
}

/**
 * Teaching policy thresholds (mirrors backend defaults).
 * These can be overridden per-subject in the future.
 */
export const TEACHING_THRESHOLDS = {
  reteach: 0.35,
  variantPractice: 0.65,
  advance: 0.85,
} as const;

export function describeTeachingAction(action: TeachingAction): string {
  const descriptions: Record<TeachingAction, string> = {
    reteach: '重新讲解',
    give_hint: '提示引导',
    worked_example: '分步示范',
    variant_practice: '变式练习',
    advance: '推进新知',
    review_later: '间隔复习',
  };
  return descriptions[action] || action;
}
