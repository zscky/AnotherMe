/**
 * Classroom Generation Capability Handler
 *
 * Wraps the classroom generation job creation as a CapabilityRuntime handler.
 * The actual generation happens asynchronously via runClassroomGenerationJob;
 * this handler creates the job record and returns the job metadata.
 */

import type { CapabilityHandler, CapabilityRequest, CapabilityStageResult, CapabilityResult } from '../capability-runtime';
import type { GenerateClassroomInput } from '@/lib/server/classroom-generation';

export interface ClassroomGenerationCapabilityPayload {
  input: GenerateClassroomInput;
  baseUrl: string;
  jobId: string;
}

export interface ClassroomGenerationCapabilityResult {
  success: boolean;
  jobId: string;
  status: string;
  step: string;
  pollUrl: string;
  pollIntervalMs: number;
}

export const classroomGenerateHandler: CapabilityHandler<ClassroomGenerationCapabilityPayload> = {
  capabilityId: 'course_generate',

  validatePayload(payload: unknown): ClassroomGenerationCapabilityPayload {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload: expected object');
    }
    const p = payload as Record<string, unknown>;
    if (!p.input || typeof p.input !== 'object') {
      throw new Error('Invalid payload: input required');
    }
    if (!p.baseUrl || typeof p.baseUrl !== 'string') {
      throw new Error('Invalid payload: baseUrl required');
    }
    if (!p.jobId || typeof p.jobId !== 'string') {
      throw new Error('Invalid payload: jobId required');
    }
    return {
      input: p.input as GenerateClassroomInput,
      baseUrl: p.baseUrl,
      jobId: p.jobId,
    };
  },

  async *execute(request: CapabilityRequest<ClassroomGenerationCapabilityPayload>): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
    const startTime = Date.now();
    const { input, baseUrl, jobId } = request.payload;

    // Stage: pre_process
    const preStart = Date.now();
    try {
      yield {
        stage: 'pre_process',
        success: true,
        output: {
          requirementPreview: input.requirement.substring(0, 100),
          hasPdf: !!input.pdfContent,
          hasLearningContext: !!input.learningContext,
        },
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

    // Stage: agent_invoke (create the job record and enqueue background runner)
    const invokeStart = Date.now();
    let jobRecord: { status: string; step: string; pollUrl: string };

    try {
      const { createClassroomGenerationJob } = await import('@/lib/server/classroom-job-store');
      const { runClassroomGenerationJob } = await import('@/lib/server/classroom-job-runner');

      const job = await createClassroomGenerationJob(jobId, input);
      jobRecord = {
        status: job.status,
        step: job.step,
        pollUrl: `${baseUrl}/api/generate-classroom/${jobId}`,
      };

      // Enqueue background generation
      void runClassroomGenerationJob(jobId, input, baseUrl);
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
      output: { jobId, status: jobRecord.status, step: jobRecord.step },
      durationMs: Date.now() - invokeStart,
      completedAt: Date.now(),
    };

    // Stage: post_process (extract knowledge points for ClassroomBook)
    const postStart = Date.now();
    const knowledgePointIds =
      input.learningContext?.knowledgeTracing?.teachingDecisions
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
      output: { jobId, wasAborted: false },
      durationMs: Date.now() - persistStart,
      completedAt: Date.now(),
    };

    // Stage: complete
    const completeStage: CapabilityStageResult = {
      stage: 'complete',
      success: true,
      output: {
        jobId,
        status: jobRecord.status,
        step: jobRecord.step,
        pollUrl: jobRecord.pollUrl,
        pollIntervalMs: 5000,
      },
      durationMs: Date.now() - startTime,
      completedAt: Date.now(),
    };
    yield completeStage;

    return {
      success: true,
      output: {
        jobId,
        status: jobRecord.status,
        step: jobRecord.step,
        pollUrl: jobRecord.pollUrl,
        pollIntervalMs: 5000,
      },
      stages: [],
      traceEvents: [],
      totalDurationMs: Date.now() - startTime,
    };
  },
};
