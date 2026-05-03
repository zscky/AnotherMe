import { NextRequest } from 'next/server';
import {
  isAnotherMe2GatewayError,
  listGatewayAILearningRecords,
} from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    if (!sessionId) {
      return apiError('INVALID_REQUEST', 400, 'Missing session id');
    }

    const requestedUserId = request.nextUrl.searchParams.get('userId');
    const userId = await resolveRequestUserId(request, requestedUserId);
    const rawLimit = Number(request.nextUrl.searchParams.get('limit') || '200');
    const limit = Number.isFinite(rawLimit) ? rawLimit : 200;

    const records = await listGatewayAILearningRecords({
      sessionId,
      userId,
      limit,
    });
    return apiSuccess({ records });
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError('INVALID_REQUEST', error.status, error.message, error.code);
    }
    if (isAnotherMe2GatewayError(error)) {
      return apiError('UPSTREAM_ERROR', error.status, error.message);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to list learning records',
    );
  }
}
