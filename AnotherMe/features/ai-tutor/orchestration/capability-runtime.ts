/**
 * Capability Runtime - Unified execution framework for all learning capabilities.
 *
 * Replaces scattered route logic in:
 * - chat/route.ts
 * - problem-video/route.ts
 * - generate-classroom/route.ts
 *
 * Execution flow:
 * CapabilityRequest
 *   -> buildLearningContext
 *   -> capability guard (check availability + permissions)
 *   -> run stages (capability-specific pipeline)
 *   -> emit trace (unified event stream)
 *   -> persist result + learning event
 */

import type { CapabilityId } from './capability-registry';
import type { LearningContext } from '@/lib/types/learning-context';
import type { TeachingTraceEvent } from '@/lib/types/teaching-trace';

export type CapabilityStage =
  | 'context_build'
  | 'guard_check'
  | 'pre_process'
  | 'agent_invoke'
  | 'agent_stream'
  | 'post_process'
  | 'persist'
  | 'complete'
  | 'error';

export interface CapabilityRequest<TPayload = Record<string, unknown>> {
  /** Unique request identifier */
  requestId: string;
  /** Capability being invoked */
  capabilityId: CapabilityId;
  /** Authenticated user identifier */
  userId: string;
  /** Raw payload from the client */
  payload: TPayload;
  /** Optional learning context (will be built if not provided) */
  learningContext?: LearningContext;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Whether to stream results */
  streaming: boolean;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface CapabilityGuardResult {
  passed: boolean;
  /** Missing required tools if guard failed */
  missingTools?: string[];
  /** Reason for rejection */
  reason?: string;
}

export interface CapabilityStageResult {
  stage: CapabilityStage;
  /** Whether the stage succeeded */
  success: boolean;
  /** Stage output payload */
  output?: Record<string, unknown>;
  /** Error if stage failed */
  error?: { code: string; message: string };
  /** Stage duration in milliseconds */
  durationMs: number;
  /** Timestamp when stage completed */
  completedAt: number;
}

export interface CapabilityResult {
  /** Whether the entire capability execution succeeded */
  success: boolean;
  /** Final output payload */
  output?: Record<string, unknown>;
  /** Execution trace */
  stages: CapabilityStageResult[];
  /** Error if execution failed */
  error?: { code: string; message: string };
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Teaching trace events emitted during execution */
  traceEvents: TeachingTraceEvent[];
}

export interface CapabilityHandler<TPayload = Record<string, unknown>> {
  /** Unique capability identifier */
  capabilityId: CapabilityId;
  /** Validate and transform the raw payload */
  validatePayload: (payload: unknown) => TPayload;
  /** Run the capability stages */
  execute: (request: CapabilityRequest<TPayload>) => AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown>;
}

export interface CapabilityRuntimeOptions {
  /** Build learning context for a request */
  buildContext: (params: { userId: string; capabilityId: CapabilityId; payload: Record<string, unknown> }) => Promise<LearningContext>;
  /** Check capability guard */
  checkGuard: (capabilityId: CapabilityId) => Promise<CapabilityGuardResult>;
  /** Emit a teaching trace event */
  emitTrace: (event: TeachingTraceEvent) => void | Promise<void>;
  /** Persist the result and optionally create a learning event */
  persistResult: (result: CapabilityResult, request: CapabilityRequest) => Promise<void>;
}

export class CapabilityRuntime {
  private handlers = new Map<CapabilityId, CapabilityHandler>();
  private options: CapabilityRuntimeOptions;

  constructor(options: CapabilityRuntimeOptions) {
    this.options = options;
  }

  registerHandler<TPayload>(handler: CapabilityHandler<TPayload>): void {
    this.handlers.set(handler.capabilityId, handler as CapabilityHandler);
  }

  async *run(request: CapabilityRequest): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
    const startTime = Date.now();
    const stages: CapabilityStageResult[] = [];
    const traceEvents: TeachingTraceEvent[] = [];

    const emitTrace = (event: TeachingTraceEvent) => {
      traceEvents.push(event);
      void this.options.emitTrace(event);
    };

    // Stage 1: Build learning context
    const contextStart = Date.now();
    let learningContext: LearningContext | undefined = request.learningContext;
    try {
      if (!learningContext) {
        learningContext = await this.options.buildContext({
          userId: request.userId,
          capabilityId: request.capabilityId,
          payload: request.payload,
        });
      }
      stages.push({
        stage: 'context_build',
        success: true,
        output: { learningContextSnapshot: learningContext.userId },
        durationMs: Date.now() - contextStart,
        completedAt: Date.now(),
      });
      emitTrace({
        type: 'learning_context_loaded',
        timestamp: Date.now(),
        requestId: request.requestId,
        payload: { userId: request.userId, capabilityId: request.capabilityId },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      stages.push({
        stage: 'context_build',
        success: false,
        error: { code: 'CONTEXT_BUILD_FAILED', message: err.message },
        durationMs: Date.now() - contextStart,
        completedAt: Date.now(),
      });
      return this._buildResult(false, stages, traceEvents, startTime, err);
    }

    // Stage 2: Capability guard
    const guardStart = Date.now();
    let guardResult: CapabilityGuardResult;
    try {
      guardResult = await this.options.checkGuard(request.capabilityId);
      stages.push({
        stage: 'guard_check',
        success: guardResult.passed,
        output: guardResult.passed ? undefined : { missingTools: guardResult.missingTools },
        error: guardResult.passed
          ? undefined
          : { code: 'GUARD_REJECTED', message: guardResult.reason || 'Capability not available' },
        durationMs: Date.now() - guardStart,
        completedAt: Date.now(),
      });
      if (!guardResult.passed) {
        return this._buildResult(
          false,
          stages,
          traceEvents,
          startTime,
          new Error(guardResult.reason || 'Capability guard rejected'),
        );
      }
      emitTrace({
        type: 'capability_guard_passed',
        timestamp: Date.now(),
        requestId: request.requestId,
        payload: { capabilityId: request.capabilityId },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      stages.push({
        stage: 'guard_check',
        success: false,
        error: { code: 'GUARD_CHECK_FAILED', message: err.message },
        durationMs: Date.now() - guardStart,
        completedAt: Date.now(),
      });
      return this._buildResult(false, stages, traceEvents, startTime, err);
    }

    // Stage 3: Execute capability handler stages
    const handler = this.handlers.get(request.capabilityId);
    if (!handler) {
      stages.push({
        stage: 'pre_process',
        success: false,
        error: { code: 'HANDLER_NOT_FOUND', message: `No handler registered for ${request.capabilityId}` },
        durationMs: 0,
        completedAt: Date.now(),
      });
      return this._buildResult(
        false,
        stages,
        traceEvents,
        startTime,
        new Error(`No handler registered for ${request.capabilityId}`),
      );
    }

    try {
      const validatedPayload = handler.validatePayload(request.payload);
      const handlerRequest: CapabilityRequest = { ...request, payload: validatedPayload };

      for await (const stageResult of handler.execute(handlerRequest)) {
        stages.push(stageResult);
        yield stageResult;
      }

      // Build final result from last stages
      const lastStage = stages[stages.length - 1];
      const success = lastStage?.success ?? false;
      const result = this._buildResult(success, stages, traceEvents, startTime);

      // Persist
      await this.options.persistResult(result, request);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      stages.push({
        stage: 'error',
        success: false,
        error: { code: 'HANDLER_ERROR', message: err.message },
        durationMs: 0,
        completedAt: Date.now(),
      });
      const result = this._buildResult(false, stages, traceEvents, startTime, err);
      await this.options.persistResult(result, request);
      return result;
    }
  }

  private _buildResult(
    success: boolean,
    stages: CapabilityStageResult[],
    traceEvents: TeachingTraceEvent[],
    startTime: number,
    error?: Error,
  ): CapabilityResult {
    return {
      success,
      stages,
      traceEvents,
      totalDurationMs: Date.now() - startTime,
      error: error
        ? { code: 'EXECUTION_ERROR', message: error.message }
        : undefined,
    };
  }
}

/**
 * Create a default runtime with no-op implementations.
 * Override options for real use.
 */
export function createDefaultRuntime(overrides?: Partial<CapabilityRuntimeOptions>): CapabilityRuntime {
  return new CapabilityRuntime({
    buildContext: async () => {
      throw new Error('buildContext not implemented');
    },
    checkGuard: async () => ({ passed: true }),
    emitTrace: async () => {},
    persistResult: async () => {},
    ...overrides,
  });
}
