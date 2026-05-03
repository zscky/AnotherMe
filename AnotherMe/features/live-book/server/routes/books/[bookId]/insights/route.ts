import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { buildLiveBookInsights } from '@/lib/server/live-book-store';

interface Params {
  params: Promise<{ bookId: string }>;
}

export async function GET(_req: NextRequest, context: Params) {
  try {
    const { bookId } = await context.params;
    const insights = await buildLiveBookInsights(bookId);
    if (!insights) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book not found');
    }

    return apiSuccess({ insights });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load live-book insights',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
