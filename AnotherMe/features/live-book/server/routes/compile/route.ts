import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { startLiveBookCompile } from '@/lib/server/live-book-store';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { bookId?: string; priorityPageId?: string };
    const bookId = (body.bookId || '').trim();
    const priorityPageId = (body.priorityPageId || '').trim() || undefined;

    if (!bookId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: bookId');
    }

    const job = await startLiveBookCompile(bookId, priorityPageId);
    if (!job) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book not found');
    }

    return apiSuccess(
      {
        job,
        pollUrl: `/api/live-book/jobs/${job.id}`,
        streamUrl: `/api/live-book/jobs/${job.id}/stream`,
      },
      202,
    );
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to start compile job',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
