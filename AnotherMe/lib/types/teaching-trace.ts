/**
 * Teaching Trace - Unified event stream for observable learning decisions.
 *
 * Every significant step in the teaching pipeline emits a TeachingTraceEvent.
 * These events can be:
 * - Logged for debugging
 * - Shown to users in a "Why did the system do that?" timeline
 * - Replayed for auditing and model improvement
 *
 * Event types:
 * - stage_start: A capability stage began
 * - learning_context_loaded: LearningContext (including KT state) is ready
 * - kt_decision_made: BKT produced a TeachingDecision
 * - prompt_built: System prompt assembled with KT context
 * - agent_response: LLM returned a response
 * - probe_generated: Diagnostic probe created
 * - learning_event_recorded: A LearningEvent was persisted
 * - kt_state_updated: BKT mastery probabilities changed after quiz answer
 * - tool_invoked: A tool (search, render, etc.) was called
 * - tool_result: Tool returned a result
 * - error: Something went wrong
 * - complete: Capability execution finished
 */

export type TeachingTraceEventType =
  | 'stage_start'
  | 'learning_context_loaded'
  | 'kt_decision_made'
  | 'prompt_built'
  | 'agent_response'
  | 'probe_generated'
  | 'learning_event_recorded'
  | 'kt_state_updated'
  | 'tool_invoked'
  | 'tool_result'
  | 'capability_guard_passed'
  | 'error'
  | 'complete';

export interface TeachingTraceEvent {
  /** Event type */
  type: TeachingTraceEventType;
  /** Monotonic timestamp (ms) */
  timestamp: number;
  /** Request / session identifier for grouping */
  requestId: string;
  /** Optional stage name */
  stage?: string;
  /** Event payload (type-specific) */
  payload: Record<string, unknown>;
  /** Optional duration in milliseconds */
  durationMs?: number;
}

// ----------------------- Payload shapes by type -----------------------

export interface StageStartPayload {
  stage: string;
  capabilityId: string;
  userId: string;
}

export interface LearningContextLoadedPayload {
  userId: string;
  capabilityId: string;
  weakKnowledgePoints: string[];
  teachingDecisionCount: number;
  enabledTools: string[];
}

export interface KTDecisionMadePayload {
  knowledgePointId: string;
  mastery: number;
  action: string;
  reason: string;
}

export interface PromptBuiltPayload {
  agentId: string;
  agentRole: string;
  promptLength: number;
  includesKtContext: boolean;
  includesTeachingDecisions: boolean;
}

export interface AgentResponsePayload {
  agentId: string;
  responseLength: number;
  textChunks: number;
  actionCount: number;
  modelName?: string;
}

export interface ProbeGeneratedPayload {
  probeId: string;
  knowledgePointId: string;
  probeType: string;
  difficulty: string;
  teachingAction: string;
}

export interface LearningEventRecordedPayload {
  eventType: string;
  eventId: string;
  userId: string;
  knowledgePoints?: string[];
}

export interface KTStateUpdatedPayload {
  knowledgePointId: string;
  priorMastery: number;
  posteriorMastery: number;
  isCorrect: boolean;
  questionId: string;
}

export interface ToolInvokedPayload {
  toolId: string;
  capabilityId: string;
  params: Record<string, unknown>;
}

export interface ToolResultPayload {
  toolId: string;
  success: boolean;
  resultSummary?: string;
  errorMessage?: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  stage?: string;
}

export interface CompletePayload {
  capabilityId: string;
  success: boolean;
  totalDurationMs: number;
}

// ----------------------- Helpers -----------------------

export function createTraceEvent(
  type: TeachingTraceEventType,
  requestId: string,
  payload: Record<string, unknown>,
  options?: { stage?: string; durationMs?: number },
): TeachingTraceEvent {
  return {
    type,
    timestamp: Date.now(),
    requestId,
    stage: options?.stage,
    payload,
    durationMs: options?.durationMs,
  };
}

export function formatTraceForDisplay(event: TeachingTraceEvent): string {
  const time = new Date(event.timestamp).toLocaleTimeString();
  switch (event.type) {
    case 'kt_decision_made':
      const p = event.payload as unknown as KTDecisionMadePayload;
      return `[${time}] KT 决策: ${p.knowledgePointId} 掌握度 ${(p.mastery * 100).toFixed(1)}% → ${p.action}`;
    case 'probe_generated':
      const pg = event.payload as unknown as ProbeGeneratedPayload;
      return `[${time}] 生成诊断题: ${pg.probeId} (${pg.probeType}, ${pg.difficulty})`;
    case 'agent_response':
      const ar = event.payload as unknown as AgentResponsePayload;
      return `[${time}] Agent ${ar.agentId} 响应: ${ar.textChunks} 文本段, ${ar.actionCount} 动作`;
    case 'error':
      const e = event.payload as unknown as ErrorPayload;
      return `[${time}] 错误 [${e.code}]: ${e.message}`;
    default:
      return `[${time}] ${event.type}`;
  }
}
