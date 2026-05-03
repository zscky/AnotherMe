import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { confirmLiveBookSpine } from '@/lib/server/live-book-store';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { bookId?: string };
    const bookId = (body.bookId || '').trim();

    if (!bookId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: bookId');
    }

    const book = await confirmLiveBookSpine(bookId);
    if (!book) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book not found');
    }

    return apiSuccess({ book });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to confirm spine',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
