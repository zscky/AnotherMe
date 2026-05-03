import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  isAnotherMe2GatewayError,
  uploadProblemImageToAnotherMe2,
} from '@/lib/server/anotherme2-gateway';
import { buildLearningContext } from '@/lib/server/learning-context';
import { createDefaultRuntime } from '@/lib/orchestration/capability-runtime';
import { globalStreamBus } from '@/lib/orchestration/stream-bus';
import { problemVideoGenerateHandler } from '@/lib/orchestration/handlers/problem-video-handler';
import { buildProblemVideoClassroomBook, saveClassroomBook } from '@/lib/server/classroom-book-service';
import { createLearningContext } from '@/lib/types/learning-context';

const DEFAULT_POLL_INTERVAL_MS = 3000;

export const maxDuration = 30;

async function resolveAuthenticatedUserId(request: NextRequest): Promise<string | undefined> {
  try {
    const { getAuthenticatedUserFromRequest } = await import('@/lib/auth/session');
    const user = await getAuthenticatedUserFromRequest(request);
    return user?.id?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get('image');
    const problemText = String(formData.get('problemText') || '').trim();
    const learnerSessionId = String(formData.get('learnerSessionId') || '').trim();
    const learnerLookbackRaw = Number(formData.get('learnerLookbackDays'));
    const learnerLookbackDays = Number.isFinite(learnerLookbackRaw)
      ? Math.max(14, Math.min(365, Math.trunc(learnerLookbackRaw)))
      : undefined;
    const userId = await resolveAuthenticatedUserId(request);

    if (!(image instanceof File) || image.size <= 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Problem image is required');
    }

    const upload = await uploadProblemImageToAnotherMe2(image);
    const learningContext = userId
      ? await buildLearningContext({
          userId,
          source: 'problem_video',
          topic: problemText || image.name,
          language: 'zh-CN',
          aiSessionId: learnerSessionId || null,
          extra: {
            imageObjectKey: upload.object_key,
            imageName: image.name,
            imageSize: image.size,
          },
          enabledTools: [
            { id: 'problem_video_generation', enabled: true, config: {} },
            { id: 'learner_memory', enabled: true, config: {} },
          ],
          lookbackDays: learnerLookbackDays,
        })
      : undefined;

    // Run through CapabilityRuntime for unified execution flow + ClassroomBook persistence
    const runtime = createDefaultRuntime({
      buildContext: async () => learningContext || createLearningContext(userId || 'anonymous', { metadata: { source: 'problem_video', topic: null, language: 'zh-CN', grade: null, extra: {} } }),
      checkGuard: async () => ({ passed: true }),
      emitTrace: async (event) => {
        globalStreamBus.publish(event);
      },
      persistResult: async (result) => {
        const output = result.output as Record<string, unknown> | undefined;
        const jobId = typeof output?.jobId === 'string' ? output.jobId : '';
        const knowledgePointIds =
          (result.stages.find((s) => s.stage === 'post_process')?.output?.knowledgePointIds as string[] | undefined) || [];

        if (jobId && userId) {
          try {
            const book = buildProblemVideoClassroomBook({
              userId,
              jobId,
              problemText,
              imageObjectKey: upload.object_key,
              sourceCapability: 'problem_video_generate',
              knowledgePointIds,
            });
            await saveClassroomBook(book);
          } catch {
            // Non-blocking: ClassroomBook persistence failure should not break video generation
          }
        }
      },
    });
    runtime.registerHandler(problemVideoGenerateHandler);

    const requestId = `pv-${userId || 'anon'}-${Date.now()}`;
    const capabilityRequest = {
      requestId,
      capabilityId: 'problem_video_generate' as const,
      userId: userId || 'anonymous',
      payload: {
        imageObjectKey: upload.object_key,
        ...(problemText ? { problemText } : {}),
        ...(userId ? { userId } : {}),
        ...(learnerSessionId ? { learnerSessionId } : {}),
        ...(typeof learnerLookbackDays === 'number' ? { learnerLookbackDays } : {}),
        ...(learningContext ? { learningContext } : {}),
      },
      streaming: false,
      signal: request.signal,
    };

    let jobResult: { job_id: string; status: string; step: string; progress: number } | null = null;
    for await (const stageResult of runtime.run(capabilityRequest)) {
      if (stageResult.stage === 'agent_invoke' && stageResult.output?.jobId) {
        jobResult = {
          job_id: String(stageResult.output.jobId),
          status: String(stageResult.output.status || 'queued'),
          step: String(stageResult.output.step || 'queued'),
          progress: typeof stageResult.output.progress === 'number' ? stageResult.output.progress : 0,
        };
      }
    }

    if (!jobResult) {
      return apiError('INTERNAL_ERROR', 500, 'Failed to create problem video job');
    }

    return apiSuccess(
      {
        jobId: jobResult.job_id,
        status: jobResult.status,
        step: jobResult.step,
        progress: jobResult.progress,
        pollUrl: `/api/problem-video/${jobResult.job_id}`,
        pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      },
      202,
    );
  } catch (error) {
    if (isAnotherMe2GatewayError(error)) {
      return apiError('UPSTREAM_ERROR', error.status, error.message);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to create AnotherMe2 problem video job',
    );
  }
}
