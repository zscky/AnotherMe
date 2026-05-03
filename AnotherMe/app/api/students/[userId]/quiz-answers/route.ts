import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createGatewayQuizAnswer } from '@/lib/server/anotherme2-gateway';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId: routeUserId } = await context.params;
    if (!routeUserId) {
      return apiError('INVALID_REQUEST', 400, 'Missing user id');
    }

    const userId = await resolveRequestUserId(request, routeUserId);
    const body = (await request.json()) as Record<string, unknown>;

    const questionId = typeof body.question_id === 'string' ? body.question_id : '';
    const isCorrect = body.is_correct === true;

    if (!questionId) {
      return apiError('INVALID_REQUEST', 400, 'Missing question_id');
    }

    const results = await createGatewayQuizAnswer({
      userId,
      questionId,
      isCorrect,
      payload: {
        knowledge_point_id: typeof body.knowledge_point_id === 'string' ? body.knowledge_point_id : undefined,
        probe_type: typeof body.probe_type === 'string' ? body.probe_type : undefined,
        client_timestamp: new Date().toISOString(),
      },
    });

    return apiSuccess({ results });
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError('INVALID_REQUEST', error.status, error.message, error.code);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to submit quiz answer',
    );
  }
}
