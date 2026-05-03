/**
 * LearningContext - Unified learning context inspired by DeepTutor's UnifiedContext.
 * 
 * This provides a single source of truth for learning state across all features:
 * course generation, classroom Q&A, problem video, review planning, and chat.
 * 
 * Instead of having separate chains of context (classroom-generation, chat route,
 * problem video job_service), all features read from the same LearningContext.
 */

export interface TeachingDecisionSnapshot {
  /** Target knowledge point identifier */
  knowledgePointId: string;
  /** Current mastery probability */
  mastery: number;
  /** Recommended teaching action */
  action: 'reteach' | 'give_hint' | 'worked_example' | 'variant_practice' | 'advance' | 'review_later';
  /** Human-readable reason for the decision */
  reason: string;
}

export interface KnowledgeTracingSnapshot {
  /** Top teaching decisions for weak knowledge points */
  teachingDecisions: TeachingDecisionSnapshot[];
  /** Raw agent-ready context text for the weakest knowledge point */
  weakestKnowledgePointContext: string | null;
}

export interface LearningContext {
  /** Unique user identifier */
  userId: string;
  
  /** Current classroom/stage ID (may be null for standalone chat) */
  classroomId: string | null;
  
  /** Current scene ID within the classroom */
  sceneId: string | null;
  
  /** AI chat session ID for persistent conversation history */
  aiSessionId: string | null;
  
  /** References to saved notebook entries */
  notebookRefs: NotebookRef[];
  
  /** Problem video job ID if this context is associated with a problem video */
  problemVideoJobId: string | null;
  
  /** Snapshot of the student's learning profile */
  studentProfile: StudentProfileSnapshot | null;

  /** Knowledge tracing state: BKT-derived mastery + teaching decisions */
  knowledgeTracing: KnowledgeTracingSnapshot | null;
  
  /** Enabled tools/capabilities for this learning session */
  enabledTools: EnabledTool[];
  
  /** Metadata about how this context was created */
  metadata: LearningContextMetadata;
  
  /** Timestamp when this context was last updated */
  updatedAt: number;
}

export interface NotebookRef {
  /** Notebook entry ID */
  id: string;
  /** Title of the notebook entry */
  title: string;
  /** Source scene ID that created this notebook entry */
  sourceSceneId: string | null;
  /** Source classroom ID */
  sourceClassroomId: string | null;
  /** Timestamp when saved */
  savedAt: number;
  /** Type of content saved */
  contentType: 'knowledge_card' | 'quiz_summary' | 'problem_solution' | 'review_note';
}

export interface StudentProfileSnapshot {
  /** Weak subjects identified from learning records */
  weakSubjects: string[];
  /** Weak knowledge points */
  weakKnowledgePoints: string[];
  /** Ability scores with metrics */
  abilityScores: AbilityScore[];
  /** Recent learning focus area */
  recentFocus: string | null;
  /** Learning statistics summary */
  learningStats: LearningStatsSummary;
  /** Snapshot timestamp */
  snapshotAt: string;
}

export interface AbilityScore {
  metric: string;
  value: number;
  fullMark: number;
}

export interface LearningStatsSummary {
  recordsTotal: number;
  records14d: number;
  activeDays14: number;
  confusionRecords: number;
  solvedRecords: number;
  topSubjects: string[];
  topKnowledgePoints: string[];
}

export interface EnabledTool {
  /** Tool identifier */
  id: string;
  /** Whether this tool is currently enabled */
  enabled: boolean;
  /** Tool configuration */
  config: Record<string, unknown>;
}

export interface LearningContextMetadata {
  /** How this context was created: 'classroom', 'chat', 'problem_video', 'review' */
  source: 'classroom' | 'chat' | 'problem_video' | 'review' | 'quiz' | 'interactive';
  /** Original learning topic or requirement */
  topic: string | null;
  /** Language preference */
  language: string;
  /** Grade level if known */
  grade: number | null;
  /** Any additional context-specific data */
  extra: Record<string, unknown>;
}

/**
 * Creates a new LearningContext with sensible defaults.
 */
export function createLearningContext(
  userId: string,
  overrides: Partial<LearningContext> = {},
): LearningContext {
  return {
    userId,
    classroomId: null,
    sceneId: null,
    aiSessionId: null,
    notebookRefs: [],
    problemVideoJobId: null,
    studentProfile: null,
    enabledTools: [],
    knowledgeTracing: null,
    metadata: {
      source: 'chat',
      topic: null,
      language: 'zh-CN',
      grade: null,
      extra: {},
    },
    updatedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Updates a LearningContext with new values, preserving existing data.
 */
export function updateLearningContext(
  context: LearningContext,
  updates: Partial<LearningContext>,
): LearningContext {
  return {
    ...context,
    ...updates,
    updatedAt: Date.now(),
  };
}

/**
 * Merges student profile data into the context.
 */
export function withStudentProfile(
  context: LearningContext,
  profile: {
    weakSubjects: string[];
    weakKnowledgePoints: string[];
    abilityScores: AbilityScore[];
    recentFocus?: string | null;
    learningStats: LearningStatsSummary;
  },
): LearningContext {
  return updateLearningContext(context, {
    studentProfile: {
      ...profile,
      recentFocus: profile.recentFocus ?? null,
      snapshotAt: new Date().toISOString(),
    },
  });
}

/**
 * Adds a notebook reference to the context.
 */
export function addNotebookRef(
  context: LearningContext,
  ref: Omit<NotebookRef, 'savedAt'>,
): LearningContext {
  return updateLearningContext(context, {
    notebookRefs: [
      ...context.notebookRefs,
      { ...ref, savedAt: Date.now() },
    ],
  });
}

/**
 * Enables or disables a tool in the context.
 */
export function setToolEnabled(
  context: LearningContext,
  toolId: string,
  enabled: boolean,
  config: Record<string, unknown> = {},
): LearningContext {
  const existingIndex = context.enabledTools.findIndex((t) => t.id === toolId);
  const updatedTools = [...context.enabledTools];
  
  if (existingIndex >= 0) {
    updatedTools[existingIndex] = { ...updatedTools[existingIndex], enabled, config };
  } else {
    updatedTools.push({ id: toolId, enabled, config });
  }
  
  return updateLearningContext(context, { enabledTools: updatedTools });
}

/**
 * Checks if a specific tool is enabled in the context.
 */
export function isToolEnabled(context: LearningContext, toolId: string): boolean {
  const tool = context.enabledTools.find((t) => t.id === toolId);
  return tool?.enabled ?? false;
}
