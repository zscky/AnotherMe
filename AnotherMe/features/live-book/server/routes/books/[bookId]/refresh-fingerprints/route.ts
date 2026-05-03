import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { refreshLiveBookFingerprints } from '@/lib/server/live-book-store';

interface Params {
  params: Promise<{ bookId: string }>;
}

export async function POST(_req: NextRequest, context: Params) {
  try {
    const { bookId } = await context.params;
    const result = await refreshLiveBookFingerprints(bookId);
    if (!result) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book not found');
    }

    return apiSuccess(result);
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to refresh live-book fingerprints',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
