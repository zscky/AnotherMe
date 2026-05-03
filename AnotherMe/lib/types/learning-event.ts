/**
 * LearningEvent - Unified learning event stream.
 * 
 * Instead of only extracting learning profiles from chat text, this defines a
 * structured event system that captures all learning behaviors:
 * - quiz_answered, hint_used, video_generated, video_watched
 * - notebook_saved, asked_question, feedback_dislike
 * - problem_solved, confusion_detected
 * 
 * These events feed directly into LearnerModelingAgent for mastery updates.
 */

export type LearningEventType =
  | 'quiz_answered'
  | 'hint_used'
  | 'video_generated'
  | 'video_watched'
  | 'notebook_saved'
  | 'asked_question'
  | 'feedback_dislike'
  | 'feedback_like'
  | 'problem_solved'
  | 'confusion_detected'
  | 'scene_completed'
  | 'scene_retried'
  | 'block_started'
  | 'time_spent'
  | 'knowledge_point_mastered'
  | 'knowledge_point_struggled';

export interface LearningEvent {
  /** Unique event ID */
  id: string;
  /** Event type */
  type: LearningEventType;
  /** User ID who triggered the event */
  userId: string;
  /** Timestamp of the event */
  timestamp: number;
  /** Associated classroom/stage ID */
  classroomId: string | null;
  /** Associated scene ID */
  sceneId: string | null;
  /** Associated block ID */
  blockId: string | null;
  /** Knowledge points related to this event */
  knowledgePoints: string[];
  /** Subject area */
  subject: string | null;
  /** Event-specific payload */
  payload: LearningEventPayload;
  /** Weight for mastery calculation (0.5 - 2.0) */
  weight: number;
  /** Source of the event: 'user_action', 'system_generated', 'ai_inferred' */
  source: 'user_action' | 'system_generated' | 'ai_inferred';
}

export type LearningEventPayload =
  | QuizAnsweredPayload
  | HintUsedPayload
  | VideoGeneratedPayload
  | VideoWatchedPayload
  | NotebookSavedPayload
  | AskedQuestionPayload
  | FeedbackPayload
  | ProblemSolvedPayload
  | ConfusionDetectedPayload
  | SceneCompletedPayload
  | SceneRetriedPayload
  | BlockStartedPayload
  | TimeSpentPayload
  | KnowledgePointPayload;

export interface QuizAnsweredPayload {
  type: 'quiz_answered';
  questionId: string;
  selectedAnswers: string[];
  correctAnswers: string[];
  isCorrect: boolean;
  timeSpentMs: number;
  attemptNumber: number;
}

export interface HintUsedPayload {
  type: 'hint_used';
  hintId: string;
  hintContent: string;
  questionId: string | null;
}

export interface VideoGeneratedPayload {
  type: 'video_generated';
  videoJobId: string;
  videoUrl: string | null;
  durationSeconds: number | null;
  knowledgePointsCovered: string[];
}

export interface VideoWatchedPayload {
  type: 'video_watched';
  videoJobId: string;
  watchDurationSeconds: number;
  totalDurationSeconds: number;
  completionRate: number;
  pausedAt: number[];
  replayedAt: number[];
}

export interface NotebookSavedPayload {
  type: 'notebook_saved';
  notebookId: string;
  notebookTitle: string;
  contentType: string;
  sourceSceneId: string | null;
}

export interface AskedQuestionPayload {
  type: 'asked_question';
  questionText: string;
  questionCategory: string | null;
  isFollowUp: boolean;
}

export interface FeedbackPayload {
  type: 'feedback_dislike' | 'feedback_like';
  messageId: string;
  reason: string | null;
  feedbackText: string | null;
}

export interface ProblemSolvedPayload {
  type: 'problem_solved';
  problemId: string;
  solutionMethod: string | null;
  timeSpentMs: number;
  attemptsCount: number;
  hintsUsedCount: number;
}

export interface ConfusionDetectedPayload {
  type: 'confusion_detected';
  detectionMethod: 'explicit' | 'implicit' | 'ai_inferred';
  context: string;
  confidenceScore: number;
  suggestedRemediation: string | null;
}

export interface SceneCompletedPayload {
  type: 'scene_completed';
  sceneType: string;
  completionTimeMs: number;
  interactionsCount: number;
}

export interface SceneRetriedPayload {
  type: 'scene_retried';
  sceneType: string;
  retryReason: string;
  previousAttempts: number;
}

export interface BlockStartedPayload {
  type: 'block_started';
  blockType: string;
  blockDifficulty: string;
}

export interface TimeSpentPayload {
  type: 'time_spent';
  activityType: string;
  durationMs: number;
  isActive: boolean;
}

export interface KnowledgePointPayload {
  type: 'knowledge_point_mastered' | 'knowledge_point_struggled';
  knowledgePoint: string;
  evidence: string;
  masteryScore: number;
}

/**
 * Creates a new LearningEvent with auto-generated ID and timestamp.
 */
export function createLearningEvent(
  userId: string,
  type: LearningEventType,
  knowledgePoints: string[],
  payload: LearningEventPayload,
  overrides: Partial<Omit<LearningEvent, 'id' | 'type' | 'userId' | 'timestamp' | 'knowledgePoints' | 'payload'>> = {},
): LearningEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    userId,
    timestamp: Date.now(),
    classroomId: null,
    sceneId: null,
    blockId: null,
    knowledgePoints,
    subject: null,
    payload,
    weight: 1.0,
    source: 'user_action',
    ...overrides,
  };
}

/**
 * Creates a quiz answered event.
 */
export function createQuizAnsweredEvent(
  userId: string,
  questionId: string,
  selectedAnswers: string[],
  correctAnswers: string[],
  knowledgePoints: string[],
  timeSpentMs: number,
  attemptNumber: number,
  classroomId?: string,
  sceneId?: string,
  blockId?: string,
): LearningEvent {
  const isCorrect = JSON.stringify(selectedAnswers.sort()) === JSON.stringify(correctAnswers.sort());
  
  return createLearningEvent(userId, 'quiz_answered', knowledgePoints, {
    type: 'quiz_answered',
    questionId,
    selectedAnswers,
    correctAnswers,
    isCorrect,
    timeSpentMs,
    attemptNumber,
  }, {
    classroomId: classroomId ?? null,
    sceneId: sceneId ?? null,
    blockId: blockId ?? null,
    weight: attemptNumber === 1 ? 1.2 : 0.8,
  });
}

/**
 * Creates a confusion detected event.
 */
export function createConfusionEvent(
  userId: string,
  context: string,
  knowledgePoints: string[],
  detectionMethod: 'explicit' | 'implicit' | 'ai_inferred' = 'explicit',
  confidenceScore: number = 0.8,
  classroomId?: string,
  sceneId?: string,
): LearningEvent {
  return createLearningEvent(userId, 'confusion_detected', knowledgePoints, {
    type: 'confusion_detected',
    detectionMethod,
    context,
    confidenceScore,
    suggestedRemediation: null,
  }, {
    classroomId: classroomId ?? null,
    sceneId: sceneId ?? null,
    weight: detectionMethod === 'explicit' ? 1.5 : 1.0,
    source: detectionMethod === 'ai_inferred' ? 'ai_inferred' : 'user_action',
  });
}

/**
 * Creates a video watched event.
 */
export function createVideoWatchedEvent(
  userId: string,
  videoJobId: string,
  watchDurationSeconds: number,
  totalDurationSeconds: number,
  knowledgePoints: string[],
  pausedAt: number[] = [],
  replayedAt: number[] = [],
): LearningEvent {
  const completionRate = totalDurationSeconds > 0 ? watchDurationSeconds / totalDurationSeconds : 0;
  
  return createLearningEvent(userId, 'video_watched', knowledgePoints, {
    type: 'video_watched',
    videoJobId,
    watchDurationSeconds,
    totalDurationSeconds,
    completionRate,
    pausedAt,
    replayedAt,
  }, {
    weight: completionRate >= 0.9 ? 1.2 : completionRate >= 0.5 ? 0.8 : 0.5,
    source: 'user_action',
  });
}

/**
 * Filters events by type.
 */
export function filterEventsByType(events: LearningEvent[], type: LearningEventType): LearningEvent[] {
  return events.filter((e) => e.type === type);
}

/**
 * Filters events by knowledge point.
 */
export function filterEventsByKnowledgePoint(events: LearningEvent[], knowledgePoint: string): LearningEvent[] {
  return events.filter((e) => e.knowledgePoints.includes(knowledgePoint));
}

/**
 * Gets events within a time range.
 */
export function getEventsInRange(events: LearningEvent[], startTime: number, endTime: number): LearningEvent[] {
  return events.filter((e) => e.timestamp >= startTime && e.timestamp <= endTime);
}

/**
 * Calculates knowledge point mastery from events.
 */
export function calculateKnowledgePointMastery(
  events: LearningEvent[],
  knowledgePoint: string,
): { mastery: number; eventCount: number; lastEventTimestamp: number | null } {
  const relevantEvents = events.filter((e) => e.knowledgePoints.includes(knowledgePoint));
  
  if (relevantEvents.length === 0) {
    return { mastery: 0.5, eventCount: 0, lastEventTimestamp: null };
  }
  
  let score = 0.5;
  const now = Date.now();
  
  for (const event of relevantEvents) {
    const ageDays = (now - event.timestamp) / (1000 * 60 * 60 * 24);
    const timeWeight = Math.exp(-ageDays / 35);
    const eventWeight = event.weight * timeWeight;
    
    switch (event.type) {
      case 'quiz_answered': {
        const payload = event.payload as QuizAnsweredPayload;
        const delta = payload.isCorrect ? 0.18 : -0.22;
        score = delta >= 0
          ? score + (1 - score) * delta * eventWeight
          : score * (1 + delta * eventWeight);
        break;
      }
      case 'confusion_detected': {
        const payload = event.payload as ConfusionDetectedPayload;
        score *= (1 - 0.28 * payload.confidenceScore * eventWeight);
        break;
      }
      case 'problem_solved': {
        const payload = event.payload as ProblemSolvedPayload;
        const delta = payload.attemptsCount <= 1 ? 0.24 : 0.15;
        score += (1 - score) * delta * eventWeight;
        break;
      }
      case 'hint_used': {
        score *= (1 - 0.08 * eventWeight);
        break;
      }
      case 'video_watched': {
        const payload = event.payload as VideoWatchedPayload;
        if (payload.completionRate >= 0.9) {
          score += (1 - score) * 0.1 * eventWeight;
        }
        break;
      }
    }
    
    score = Math.max(0, Math.min(1, score));
  }
  
  return {
    mastery: Math.round(score * 100) / 100,
    eventCount: relevantEvents.length,
    lastEventTimestamp: relevantEvents[relevantEvents.length - 1]?.timestamp ?? null,
  };
}
