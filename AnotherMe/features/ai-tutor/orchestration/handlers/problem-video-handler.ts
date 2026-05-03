/**
 * Problem Video Generation Capability Handler
 *
 * Wraps the problem video generation (upload + job creation) as a CapabilityRuntime handler.
 * The actual video rendering happens asynchronously in the AnotherMe2 gateway;
 * this handler only creates the job and returns the job metadata.
 */

import type { CapabilityHandler, CapabilityRequest, CapabilityStageResult, CapabilityResult } from '../capability-runtime';
import type { LearningContext } from '@/lib/types/learning-context';

export interface ProblemVideoCapabilityPayload {
  imageObjectKey: string;
  problemText?: string;
  userId?: string;
  learnerSessionId?: string;
  learnerLookbackDays?: number;
  learningContext?: LearningContext;
}

export interface ProblemVideoCapabilityResult {
  success: boolean;
  jobId: string;
  status: string;
  step: string;
  progress: number;
  pollUrl: string;
  pollIntervalMs: number;
}

export const problemVideoGenerateHandler: CapabilityHandler<ProblemVideoCapabilityPayload> = {
  capabilityId: 'problem_video_generate',

  validatePayload(payload: unknown): ProblemVideoCapabilityPayload {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload: expected object');
    }
    const p = payload as Record<string, unknown>;
    if (!p.imageObjectKey || typeof p.imageObjectKey !== 'string') {
      throw new Error('Invalid payload: imageObjectKey required');
    }
    return {
      imageObjectKey: p.imageObjectKey,
      problemText: typeof p.problemText === 'string' ? p.problemText : undefined,
      userId: typeof p.userId === 'string' ? p.userId : undefined,
      learnerSessionId: typeof p.learnerSessionId === 'string' ? p.learnerSessionId : undefined,
      learnerLookbackDays: typeof p.learnerLookbackDays === 'number' ? p.learnerLookbackDays : undefined,
      learningContext: p.learningContext as LearningContext | undefined,
    };
  },

  async *execute(request: CapabilityRequest<ProblemVideoCapabilityPayload>): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
    const startTime = Date.now();
    const { imageObjectKey, problemText, userId, learnerSessionId, learnerLookbackDays, learningContext } = request.payload;

    // Stage: pre_process
    const preStart = Date.now();
    try {
      yield {
        stage: 'pre_process',
        success: true,
        output: { hasProblemText: !!problemText?.trim(), hasLearningContext: !!learningContext },
        durationMs: Date.now() - preStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      yield {
        stage: 'pre_process',
        success: false,
        error: { code: 'PRE_PROCESS_FAILED', message: err.message },
        durationMs: Date.now() - preStart,
        completedAt: Date.now(),
      };
      throw err;
    }

    // Stage: agent_invoke (create the job via gateway)
    const invokeStart = Date.now();
    let jobResult: { job_id: string; status: string; step: string; progress: number };

    try {
      const { createAnotherMe2ProblemVideoJob } = await import('@/lib/server/anotherme2-gateway');
      jobResult = await createAnotherMe2ProblemVideoJob({
        imageObjectKey,
        ...(problemText ? { problemText } : {}),
        ...(userId ? { userId } : {}),
        ...(learnerSessionId ? { learnerSessionId } : {}),
        ...(typeof learnerLookbackDays === 'number' ? { learnerLookbackDays } : {}),
        ...(learningContext ? { learningContext } : {}),
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      yield {
        stage: 'agent_invoke',
        success: false,
        error: { code: 'AGENT_INVOKE_FAILED', message: err.message },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };
      throw err;
    }

    yield {
      stage: 'agent_invoke',
      success: true,
      output: { jobId: jobResult.job_id, status: jobResult.status, step: jobResult.step },
      durationMs: Date.now() - invokeStart,
      completedAt: Date.now(),
    };

    // Stage: post_process (extract knowledge points for ClassroomBook)
    const postStart = Date.now();
    const knowledgePointIds =
      learningContext?.knowledgeTracing?.teachingDecisions
        ?.map((d: { knowledgePointId: string }) => d.knowledgePointId)
        .filter(Boolean) || [];

    yield {
      stage: 'post_process',
      success: true,
      output: { knowledgePointIds },
      durationMs: Date.now() - postStart,
      completedAt: Date.now(),
    };

    // Stage: persist
    const persistStart = Date.now();
    yield {
      stage: 'persist',
      success: true,
      output: { jobId: jobResult.job_id, wasAborted: false },
      durationMs: Date.now() - persistStart,
      completedAt: Date.now(),
    };

    // Stage: complete
    const completeStage: CapabilityStageResult = {
      stage: 'complete',
      success: true,
      output: {
        jobId: jobResult.job_id,
        status: jobResult.status,
        step: jobResult.step,
        progress: jobResult.progress,
      },
      durationMs: Date.now() - startTime,
      completedAt: Date.now(),
    };
    yield completeStage;

    return {
      success: true,
      output: {
        jobId: jobResult.job_id,
        status: jobResult.status,
        step: jobResult.step,
        progress: jobResult.progress,
      },
      stages: [],
      traceEvents: [],
      totalDurationMs: Date.now() - startTime,
    };
  },
};
