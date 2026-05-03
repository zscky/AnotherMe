import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { compileLiveBookPage } from '@/lib/server/live-book-store';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      bookId?: string;
      pageId?: string;
      force?: boolean;
    };

    const bookId = (body.bookId || '').trim();
    const pageId = (body.pageId || '').trim();

    if (!bookId || !pageId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: bookId/pageId');
    }

    const book = await compileLiveBookPage(bookId, pageId, Boolean(body.force));
    if (!book) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book or page not found');
    }

    return apiSuccess({ book });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to compile page',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
