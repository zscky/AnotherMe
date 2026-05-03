import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { chatWithLiveBookPage } from '@/lib/server/live-book-store';

interface Params {
  params: Promise<{ bookId: string }>;
}

export async function POST(req: NextRequest, context: Params) {
  try {
    const { bookId } = await context.params;
    const body = (await req.json()) as {
      pageId?: string;
      message?: string;
    };

    const pageId = (body.pageId || '').trim();
    const message = (body.message || '').trim();

    if (!pageId || !message) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required fields: pageId/message');
    }

    const result = await chatWithLiveBookPage(bookId, { pageId, message });
    if (!result) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book or page not found');
    }

    return apiSuccess({ reply: result.reply, book: result.book });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to process page chat',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
