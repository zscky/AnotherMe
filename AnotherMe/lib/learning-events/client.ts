import type { LearningEventType } from '@/lib/types/learning-event';
import type { LearningContext } from '@/lib/types/learning-context';

export interface RecordLearningEventInput {
  eventType: LearningEventType;
  sessionId?: string | null;
  classroomId?: string | null;
  sceneId?: string | null;
  blockId?: string | null;
  knowledgePoints?: string[];
  payload?: Record<string, unknown>;
  learningContext?: Partial<LearningContext> | null;
  weight?: number;
}

function sourceFromEventType(eventType: LearningEventType): LearningContext['metadata']['source'] {
  if (eventType === 'quiz_answered') return 'quiz';
  if (eventType === 'video_watched') return 'problem_video';
  if (eventType === 'notebook_saved') return 'review';
  return 'interactive';
}

function buildEventContext(input: RecordLearningEventInput): Partial<LearningContext> {
  return {
    classroomId: input.classroomId || null,
    sceneId: input.sceneId || null,
    aiSessionId: input.sessionId || null,
    metadata: {
      source: sourceFromEventType(input.eventType),
      topic: input.knowledgePoints?.[0] || null,
      language: 'zh-CN',
      grade: null,
      extra: {
        blockId: input.blockId || null,
        eventType: input.eventType,
      },
    },
    updatedAt: Date.now(),
  };
}

export async function recordLearningEvent(input: RecordLearningEventInput): Promise<void> {
  if (typeof window === 'undefined') return;

  const learningContext = input.learningContext ?? buildEventContext(input);
  const payload = {
    ...(input.payload || {}),
    learning_context: learningContext,
  };

  try {
    await fetch('/api/learning-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventType: input.eventType,
        sessionId: input.sessionId || undefined,
        classroomId: input.classroomId || undefined,
        sceneId: input.sceneId || undefined,
        blockId: input.blockId || undefined,
        knowledgePoints: input.knowledgePoints,
        payload,
        weight: input.weight,
      }),
      keepalive: true,
    });
  } catch {
    // Telemetry should not interrupt the learning workflow.
  }
}
