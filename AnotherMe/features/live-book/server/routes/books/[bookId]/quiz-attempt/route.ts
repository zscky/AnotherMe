import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { submitLiveBookQuizAttempt } from '@/lib/server/live-book-store';

interface Params {
  params: Promise<{ bookId: string }>;
}

export async function POST(req: NextRequest, context: Params) {
  try {
    const { bookId } = await context.params;
    const body = (await req.json()) as {
      pageId?: string;
      blockId?: string;
      questionId?: string;
      userAnswer?: string;
      isCorrect?: boolean;
    };

    const pageId = (body.pageId || '').trim();
    const blockId = (body.blockId || '').trim();

    if (!pageId || !blockId || typeof body.isCorrect !== 'boolean') {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'Missing required fields: pageId/blockId/isCorrect',
      );
    }

    const book = await submitLiveBookQuizAttempt(bookId, {
      pageId,
      blockId,
      ...(body.questionId ? { questionId: body.questionId } : {}),
      ...(body.userAnswer ? { userAnswer: body.userAnswer } : {}),
      isCorrect: body.isCorrect,
    });

    if (!book) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book or page not found');
    }

    return apiSuccess({ book });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to submit quiz attempt',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
