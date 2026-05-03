import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { regenerateLiveBookBlock } from '@/lib/server/live-book-store';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      bookId?: string;
      pageId?: string;
      blockId?: string;
    };

    const bookId = (body.bookId || '').trim();
    const pageId = (body.pageId || '').trim();
    const blockId = (body.blockId || '').trim();

    if (!bookId || !pageId || !blockId) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'Missing required field: bookId/pageId/blockId',
      );
    }

    const book = await regenerateLiveBookBlock(bookId, pageId, blockId);
    if (!book) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book/page/block not found');
    }

    return apiSuccess({ book });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to regenerate block',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
