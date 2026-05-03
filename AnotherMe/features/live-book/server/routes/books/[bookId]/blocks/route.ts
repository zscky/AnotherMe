import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { operateLiveBookBlock } from '@/lib/server/live-book-store';

interface Params {
  params: Promise<{ bookId: string }>;
}

export async function POST(req: NextRequest, context: Params) {
  try {
    const { bookId } = await context.params;
    const body = (await req.json()) as {
      action?: 'regenerate' | 'insert' | 'move' | 'delete';
      pageId?: string;
      blockId?: string;
      direction?: 'up' | 'down';
      blockType?:
        | 'section'
        | 'text'
        | 'quiz'
        | 'interactive'
        | 'animation'
        | 'deep_dive'
        | 'remedial'
        | 'callout'
        | 'figure'
        | 'flash_cards'
        | 'code'
        | 'timeline'
        | 'concept_graph'
        | 'user_note'
        | 'placeholder';
      title?: string;
      content?: string;
    };

    const action = body.action;
    const pageId = (body.pageId || '').trim();
    if (!action || !pageId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required fields: action/pageId');
    }

    const book = await operateLiveBookBlock(bookId, {
      action,
      pageId,
      ...(body.blockId ? { blockId: body.blockId } : {}),
      ...(body.direction ? { direction: body.direction } : {}),
      ...(body.blockType ? { blockType: body.blockType } : {}),
      ...(body.title ? { title: body.title } : {}),
      ...(body.content ? { content: body.content } : {}),
    });

    if (!book) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book/page/block not found');
    }

    return apiSuccess({ book });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to operate block',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
