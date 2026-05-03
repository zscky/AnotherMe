/**
 * Trace Events - Process event trace visualization.
 * 
 * Instead of only showing progress/step, this exposes internal workflow steps
 * as frontend-readable trace events. For problem video workflow, this shows:
 * - What knowledge points were identified
 * - What weaknesses were discovered
 * - What Manim errors were fixed
 * 
 * For course generation, this shows:
 * - Research phase results
 * - Outline generation details
 * - Scene generation progress per scene
 * - Quality gate results
 */

export type TraceEventType =
  | 'workflow_started'
  | 'workflow_step_started'
  | 'workflow_step_completed'
  | 'workflow_step_failed'
  | 'workflow_completed'
  | 'knowledge_identified'
  | 'weakness_discovered'
  | 'manim_error_fixed'
  | 'tts_generated'
  | 'video_rendered'
  | 'quality_gate_passed'
  | 'quality_gate_failed'
  | 'retry_attempted'
  | 'artifact_uploaded'
  | 'learner_profile_loaded'
  | 'adaptive_plan_generated';

export interface TraceEvent {
  /** Unique trace ID */
  id: string;
  /** Event type */
  type: TraceEventType;
  /** Timestamp */
  timestamp: number;
  /** Workflow/job ID this trace belongs to */
  jobId: string;
  /** Step name in the workflow */
  step: string;
  /** Duration of this step in milliseconds */
  durationMs: number | null;
  /** Status of this step */
  status: 'running' | 'completed' | 'failed' | 'skipped';
  /** Trace-specific payload */
  payload: TracePayload;
  /** Human-readable message */
  message: string;
  /** Severity level */
  severity: 'info' | 'warning' | 'error' | 'success';
}

export type TracePayload =
  | WorkflowStartedPayload
  | WorkflowStepPayload
  | KnowledgeIdentifiedPayload
  | WeaknessDiscoveredPayload
  | ManimErrorFixedPayload
  | TTSGeneratedPayload
  | VideoRenderedPayload
  | QualityGatePayload
  | RetryAttemptedPayload
  | ArtifactUploadedPayload
  | LearnerProfileLoadedPayload
  | AdaptivePlanPayload;

export interface WorkflowStartedPayload {
  type: 'workflow_started';
  workflowName: string;
  totalSteps: number;
  inputSummary: Record<string, unknown>;
}

export interface WorkflowStepPayload {
  type: 'workflow_step';
  stepIndex: number;
  totalSteps: number;
  details: Record<string, unknown>;
}

export interface KnowledgeIdentifiedPayload {
  type: 'knowledge_identified';
  knowledgePoints: string[];
  confidence: number;
  source: 'vision' | 'text' | 'inferred';
}

export interface WeaknessDiscoveredPayload {
  type: 'weakness_discovered';
  knowledgePoint: string;
  masteryScore: number;
  commonMistakes: string[];
  suggestedRemediation: string;
}

export interface ManimErrorFixedPayload {
  type: 'manim_error_fixed';
  errorType: string;
  errorMessage: string;
  fixApplied: string;
  retryCount: number;
}

export interface TTSGeneratedPayload {
  type: 'tts_generated';
  textLength: number;
  audioDurationSeconds: number;
  provider: string;
  voice: string;
}

export interface VideoRenderedPayload {
  type: 'video_rendered';
  resolution: string;
  fps: number;
  durationSeconds: number;
  fileSizeBytes: number;
}

export interface QualityGatePayload {
  type: 'quality_gate';
  checkName: string;
  passed: boolean;
  score: number;
  details: string;
}

export interface RetryAttemptedPayload {
  type: 'retry_attempted';
  stepName: string;
  attemptNumber: number;
  maxAttempts: number;
  reason: string;
}

export interface ArtifactUploadedPayload {
  type: 'artifact_uploaded';
  artifactType: string;
  artifactUrl: string;
  fileSizeBytes: number;
}

export interface LearnerProfileLoadedPayload {
  type: 'learner_profile_loaded';
  userId: string;
  weakSubjects: string[];
  weakKnowledgePoints: string[];
  abilityScores: Array<{ metric: string; value: number }>;
}

export interface AdaptivePlanPayload {
  type: 'adaptive_plan';
  mode: 'remedial' | 'standard' | 'advanced';
  weakKnowledgePoints: string[];
  ttsProfile: Record<string, string>;
  visualProfile: Record<string, string | boolean>;
}

/**
 * Creates a new trace event.
 */
export function createTraceEvent(
  jobId: string,
  type: TraceEventType,
  step: string,
  payload: TracePayload,
  message: string,
  severity: 'info' | 'warning' | 'error' | 'success' = 'info',
  status: 'running' | 'completed' | 'failed' | 'skipped' = 'running',
): TraceEvent {
  return {
    id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    timestamp: Date.now(),
    jobId,
    step,
    durationMs: null,
    status,
    payload,
    message,
    severity,
  };
}

/**
 * Creates a workflow started trace event.
 */
export function createWorkflowStartedTrace(
  jobId: string,
  workflowName: string,
  totalSteps: number,
  inputSummary: Record<string, unknown> = {},
): TraceEvent {
  return createTraceEvent(
    jobId,
    'workflow_started',
    'init',
    {
      type: 'workflow_started',
      workflowName,
      totalSteps,
      inputSummary,
    },
    `Workflow "${workflowName}" started with ${totalSteps} steps`,
    'info',
    'running',
  );
}

/**
 * Creates a knowledge identified trace event.
 */
export function createKnowledgeIdentifiedTrace(
  jobId: string,
  step: string,
  knowledgePoints: string[],
  confidence: number,
  source: 'vision' | 'text' | 'inferred' = 'vision',
): TraceEvent {
  return createTraceEvent(
    jobId,
    'knowledge_identified',
    step,
    {
      type: 'knowledge_identified',
      knowledgePoints,
      confidence,
      source,
    },
    `Identified ${knowledgePoints.length} knowledge point(s): ${knowledgePoints.join(', ')}`,
    'success',
    'completed',
  );
}

/**
 * Creates a weakness discovered trace event.
 */
export function createWeaknessDiscoveredTrace(
  jobId: string,
  step: string,
  knowledgePoint: string,
  masteryScore: number,
  commonMistakes: string[],
  suggestedRemediation: string,
): TraceEvent {
  return createTraceEvent(
    jobId,
    'weakness_discovered',
    step,
    {
      type: 'weakness_discovered',
      knowledgePoint,
      masteryScore,
      commonMistakes,
      suggestedRemediation,
    },
    `Discovered weakness in "${knowledgePoint}" (mastery: ${Math.round(masteryScore * 100)}%)`,
    'warning',
    'completed',
  );
}

/**
 * Creates a Manim error fixed trace event.
 */
export function createManimErrorFixedTrace(
  jobId: string,
  step: string,
  errorType: string,
  errorMessage: string,
  fixApplied: string,
  retryCount: number,
): TraceEvent {
  return createTraceEvent(
    jobId,
    'manim_error_fixed',
    step,
    {
      type: 'manim_error_fixed',
      errorType,
      errorMessage,
      fixApplied,
      retryCount,
    },
    `Fixed Manim error: ${errorType} (${retryCount} retries)`,
    'warning',
    'completed',
  );
}

/**
 * Groups trace events by step for display.
 */
export function groupTracesByStep(traces: TraceEvent[]): Map<string, TraceEvent[]> {
  const grouped = new Map<string, TraceEvent[]>();
  
  for (const trace of traces) {
    const existing = grouped.get(trace.step) || [];
    existing.push(trace);
    grouped.set(trace.step, existing);
  }
  
  return grouped;
}

/**
 * Gets the current workflow status from traces.
 */
export function getWorkflowStatus(traces: TraceEvent[]): {
  status: 'not_started' | 'running' | 'completed' | 'failed';
  currentStep: string | null;
  progress: number;
  totalSteps: number;
  completedSteps: number;
} {
  if (traces.length === 0) {
    return { status: 'not_started', currentStep: null, progress: 0, totalSteps: 0, completedSteps: 0 };
  }
  
  const startedEvent = traces.find((t) => t.type === 'workflow_started');
  const totalSteps = (startedEvent?.payload as WorkflowStartedPayload)?.totalSteps ?? 0;
  
  const completedSteps = traces.filter((t) => t.status === 'completed' && t.type === 'workflow_step_completed').length;
  const failedSteps = traces.filter((t) => t.status === 'failed').length;
  
  const hasCompleted = traces.some((t) => t.type === 'workflow_completed');
  const hasFailed = traces.some((t) => t.type === 'workflow_step_failed' && t.severity === 'error');
  
  const lastRunning = [...traces].reverse().find((t) => t.status === 'running');
  
  return {
    status: hasCompleted ? 'completed' : hasFailed ? 'failed' : 'running',
    currentStep: lastRunning?.step ?? null,
    progress: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
    totalSteps,
    completedSteps,
  };
}

/**
 * Gets a summary of knowledge points identified across all traces.
 */
export function getKnowledgePointSummary(traces: TraceEvent[]): {
  identified: string[];
  weaknesses: Array<{ point: string; mastery: number }>;
  errorsFixed: number;
} {
  const identified = new Set<string>();
  const weaknesses: Array<{ point: string; mastery: number }> = [];
  let errorsFixed = 0;
  
  for (const trace of traces) {
    if (trace.type === 'knowledge_identified') {
      const payload = trace.payload as KnowledgeIdentifiedPayload;
      for (const kp of payload.knowledgePoints) {
        identified.add(kp);
      }
    } else if (trace.type === 'weakness_discovered') {
      const payload = trace.payload as WeaknessDiscoveredPayload;
      weaknesses.push({ point: payload.knowledgePoint, mastery: payload.masteryScore });
    } else if (trace.type === 'manim_error_fixed') {
      errorsFixed++;
    }
  }
  
  return {
    identified: Array.from(identified),
    weaknesses,
    errorsFixed,
  };
}
