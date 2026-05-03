import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getLiveBook, reorderLiveBookChapters } from '@/lib/server/live-book-store';

interface Params {
  params: Promise<{ bookId: string }>;
}

export async function GET(_req: NextRequest, context: Params) {
  try {
    const { bookId } = await context.params;
    const book = await getLiveBook(bookId);
    if (!book) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book not found');
    }

    return apiSuccess({ book });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load live book',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

export async function PATCH(req: NextRequest, context: Params) {
  try {
    const { bookId } = await context.params;
    const body = (await req.json()) as { chapterOrder?: string[] };

    if (!Array.isArray(body.chapterOrder)) {
      return apiError('INVALID_REQUEST', 400, 'chapterOrder must be an array');
    }

    const book = await reorderLiveBookChapters(bookId, body.chapterOrder);
    if (!book) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book not found');
    }

    return apiSuccess({ book });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to reorder chapters',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
