import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getLiveBookPage } from '@/lib/server/live-book-store';

interface Params {
  params: Promise<{ bookId: string; pageId: string }>;
}

export async function GET(_req: NextRequest, context: Params) {
  try {
    const { bookId, pageId } = await context.params;
    const data = await getLiveBookPage(bookId, pageId);
    if (!data) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book or page not found');
    }

    return apiSuccess({ book: data.book, page: data.page });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load live-book page',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
