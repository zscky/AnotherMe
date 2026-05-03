import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { checkLiveBookHealth } from '@/lib/server/live-book-store';

interface Params {
  params: Promise<{ bookId: string }>;
}

export async function GET(_req: NextRequest, context: Params) {
  try {
    const { bookId } = await context.params;
    const health = await checkLiveBookHealth(bookId);
    if (!health) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book not found');
    }

    return apiSuccess({ health });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to inspect live-book health',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
