import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getLiveBookJob } from '@/lib/server/live-book-store';

interface Params {
  params: Promise<{ jobId: string }>;
}

export async function GET(_req: NextRequest, context: Params) {
  try {
    const { jobId } = await context.params;
    const job = await getLiveBookJob(jobId);
    if (!job) {
      return apiError('FILE_NOT_FOUND', 404, 'Live-book job not found');
    }

    return apiSuccess({ job });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load live-book job',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
