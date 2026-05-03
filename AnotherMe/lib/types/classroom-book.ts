/**
 * ClassroomBook - Persistent learning artifact inspired by DeepTutor Book Engine.
 *
 * A ClassroomBook is not just a generated classroom JSON. It is a durable,
 * queryable, and replayable learning product that includes:
 * - Structured chapters/scenes
 * - Concept graph linking knowledge points
 * - Source anchors tracing every block back to its origin
 * - Quiz attempts as first-class learning events
 * - Mastery snapshots at generation and update time
 * - Staleness flags for incremental refresh
 */

export interface ClassroomBook {
  /** Unique book identifier */
  id: string;
  /** Book title */
  title: string;
  /** Owner user identifier */
  userId: string;
  /** Chapters / scenes in reading order */
  chapters: BookChapter[];
  /** Concept graph: nodes = knowledge points, edges = relations */
  conceptGraph: ConceptGraph;
  /** Learning blocks: the smallest addressable teaching unit */
  blocks: LearningBlock[];
  /** Source anchors: every block knows where it came from */
  sourceAnchors: SourceAnchor[];
  /** Quiz attempts tied to this book */
  quizAttempts: BookQuizAttempt[];
  /** Mastery snapshot at the time of last book update */
  masterySnapshot: MasterySnapshot | null;
  /** Staleness flags for incremental refresh */
  staleFlags: StaleFlag[];
  /** Generation metadata */
  meta: BookMeta;
  /** Creation and update timestamps */
  createdAt: string;
  updatedAt: string;
}

export interface BookChapter {
  id: string;
  title: string;
  description?: string | null;
  /** Ordered scene IDs in this chapter */
  sceneIds: string[];
  /** Difficulty level */
  difficulty?: 'easy' | 'medium' | 'hard' | null;
  /** Estimated duration in minutes */
  estimatedMinutes?: number | null;
}

export interface ConceptGraph {
  /** Knowledge point nodes */
  nodes: ConceptNode[];
  /** Relationships between nodes */
  edges: ConceptEdge[];
}

export interface ConceptNode {
  id: string;
  label: string;
  /** Canonical knowledge point ID (links to KT system) */
  knowledgePointId?: string | null;
  /** Node category */
  category: 'concept' | 'formula' | 'theorem' | 'method' | 'example' | 'exercise';
  /** Description or definition */
  description?: string | null;
}

export interface ConceptEdge {
  from: string;
  to: string;
  /** Relationship type */
  relation: 'prerequisite' | 'extends' | 'applies' | 'similar' | 'contrast' | 'part_of';
  /** Optional weight/strength */
  weight?: number;
}

export interface LearningBlock {
  /** Block identifier */
  id: string;
  /** Block type determines rendering */
  type: 'explanation' | 'worked_example' | 'quiz' | 'hint' | 'summary' | 'probe' | 'interaction';
  /** Human-readable title */
  title: string;
  /** Block content (Markdown or structured JSON) */
  content: string;
  /** Associated knowledge point IDs */
  knowledgePointIds: string[];
  /** Source anchor IDs that produced this block */
  sourceAnchorIds: string[];
  /** Difficulty */
  difficulty?: 'easy' | 'medium' | 'hard' | null;
  /** Estimated reading time in seconds */
  estimatedSeconds?: number | null;
  /** Whether this block has been completed by the learner */
  completed: boolean;
  /** Completion timestamp */
  completedAt?: string | null;
  /** Order index within its chapter */
  orderIndex: number;
}

export interface SourceAnchor {
  /** Anchor identifier */
  id: string;
  /** Source type */
  sourceType: 'pdf' | 'user_question' | 'note' | 'history_error' | 'web' | 'generated' | 'kt_decision';
  /** Source document / session identifier */
  sourceId: string;
  /** Human-readable source name */
  sourceName: string;
  /** Location within the source (page number, paragraph, timestamp, etc.) */
  location?: string | null;
  /** Content snippet or summary from the source */
  contentSnippet?: string | null;
  /** URL if applicable */
  url?: string | null;
  /** When this anchor was captured */
  capturedAt: string;
}

export interface BookQuizAttempt {
  /** Attempt identifier */
  id: string;
  /** Which block this attempt belongs to */
  blockId: string;
  /** Question text */
  question: string;
  /** Student's answer */
  studentAnswer: string;
  /** Correct answer */
  correctAnswer: string;
  /** Whether the answer was correct */
  isCorrect: boolean;
  /** Number of hints used */
  hintsUsed: number;
  /** Time spent in milliseconds */
  durationMs: number;
  /** KT state before this attempt */
  priorMastery: Record<string, number>;
  /** KT state after this attempt */
  posteriorMastery: Record<string, number>;
  /** Timestamp */
  attemptedAt: string;
}

export interface MasterySnapshot {
  /** When the snapshot was taken */
  snapshotAt: string;
  /** Mastery probabilities by knowledge point */
  masteryByKnowledgePoint: Record<string, number>;
  /** Overall book completion rate (0-1) */
  completionRate: number;
  /** Average accuracy on quizzes in this book */
  averageQuizAccuracy: number;
}

export interface StaleFlag {
  /** What is stale */
  targetType: 'chapter' | 'block' | 'concept_graph' | 'mastery_snapshot';
  /** Target identifier */
  targetId: string;
  /** Why it became stale */
  reason: string;
  /** When staleness was detected */
  flaggedAt: string;
}

export interface BookMeta {
  /** Generation source capability */
  sourceCapability: string;
  /** Model used for generation */
  modelName?: string | null;
  /** Original topic or prompt */
  originalTopic: string;
  /** Language */
  language: string;
  /** Grade level */
  grade?: number | null;
  /** Number of generation iterations or refinements */
  generationVersion: number;
  /** Whether this book was human-edited */
  humanEdited: boolean;
}

// ----------------------- Helper functions -----------------------

export function createEmptyBook(params: {
  id: string;
  title: string;
  userId: string;
  originalTopic: string;
  language?: string;
  sourceCapability?: string;
}): ClassroomBook {
  const now = new Date().toISOString();
  return {
    id: params.id,
    title: params.title,
    userId: params.userId,
    chapters: [],
    conceptGraph: { nodes: [], edges: [] },
    blocks: [],
    sourceAnchors: [],
    quizAttempts: [],
    masterySnapshot: null,
    staleFlags: [],
    meta: {
      sourceCapability: params.sourceCapability || 'course_generate',
      originalTopic: params.originalTopic,
      language: params.language || 'zh-CN',
      generationVersion: 1,
      humanEdited: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function addSourceAnchor(
  book: ClassroomBook,
  anchor: Omit<SourceAnchor, 'id' | 'capturedAt'>,
): ClassroomBook {
  const newAnchor: SourceAnchor = {
    ...anchor,
    id: `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    capturedAt: new Date().toISOString(),
  };
  return {
    ...book,
    sourceAnchors: [...book.sourceAnchors, newAnchor],
    updatedAt: new Date().toISOString(),
  };
}

export function addBlock(
  book: ClassroomBook,
  block: Omit<LearningBlock, 'id'>,
): ClassroomBook {
  const newBlock: LearningBlock = {
    ...block,
    id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  return {
    ...book,
    blocks: [...book.blocks, newBlock],
    updatedAt: new Date().toISOString(),
  };
}

export function flagStale(
  book: ClassroomBook,
  targetType: StaleFlag['targetType'],
  targetId: string,
  reason: string,
): ClassroomBook {
  const flag: StaleFlag = {
    targetType,
    targetId,
    reason,
    flaggedAt: new Date().toISOString(),
  };
  return {
    ...book,
    staleFlags: [...book.staleFlags.filter((f) => !(f.targetType === targetType && f.targetId === targetId)), flag],
    updatedAt: new Date().toISOString(),
  };
}

export function updateMasterySnapshot(
  book: ClassroomBook,
  mastery: Record<string, number>,
  completionRate: number,
  averageQuizAccuracy: number,
): ClassroomBook {
  return {
    ...book,
    masterySnapshot: {
      snapshotAt: new Date().toISOString(),
      masteryByKnowledgePoint: mastery,
      completionRate,
      averageQuizAccuracy,
    },
    updatedAt: new Date().toISOString(),
  };
}
