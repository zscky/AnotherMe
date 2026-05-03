import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  getAnotherMe2Job,
  getAnotherMe2ProblemVideoResult,
  isAnotherMe2GatewayError,
} from '@/lib/server/anotherme2-gateway';

export const maxDuration = 30;

function isGatewayJobNotFound(status: number, message: string): boolean {
  if (status !== 404) return false;
  const lowered = message.toLowerCase();
  return lowered.includes('job not found') || lowered.includes('任务不存在');
}

function normalizeResult(
  jobId: string,
  result: Awaited<ReturnType<typeof getAnotherMe2ProblemVideoResult>>,
) {
  const rawVideoUrl = typeof result.video_url === 'string' ? result.video_url.trim() : '';
  const videoUrl =
    rawVideoUrl && /^https?:\/\//i.test(rawVideoUrl)
      ? rawVideoUrl
      : rawVideoUrl
        ? `/api/problem-video/${encodeURIComponent(jobId)}/result-video`
        : null;

  return {
    videoUrl,
    durationSec: result.duration_sec,
    scriptStepsCount: result.script_steps_count,
    debugBundleUrl: result.debug_bundle_url || null,
  };
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    if (!jobId) {
      return apiError('INVALID_REQUEST', 400, 'Missing job id');
    }

    const job = await getAnotherMe2Job(jobId);
    const payload: Record<string, unknown> = {
      jobId: job.job_id,
      status: job.status,
      step: job.step,
      progress: job.progress,
      errorMessage: job.error_message || null,
    };

    if (job.status === 'succeeded') {
      const result = await getAnotherMe2ProblemVideoResult(jobId);
      payload.result = normalizeResult(jobId, result);
    }

    return apiSuccess(payload);
  } catch (error) {
    if (isAnotherMe2GatewayError(error)) {
      if (isGatewayJobNotFound(error.status, error.message)) {
        return apiSuccess({
          jobId: (await context.params).jobId,
          status: 'failed',
          step: 'failed',
          progress: 100,
          errorMessage: '任务不存在或已被清理',
        });
      }
      return apiError('UPSTREAM_ERROR', error.status, error.message);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to query AnotherMe2 problem video job',
    );
  }
}
