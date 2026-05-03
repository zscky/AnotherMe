import { NextRequest } from 'next/server';
import { createGatewayDiagnosticProbe, isAnotherMe2GatewayError } from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
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

    const probe = await createGatewayDiagnosticProbe({
      userId,
      knowledgePointId: typeof body.knowledgePointId === 'string' ? body.knowledgePointId : undefined,
      difficulty: typeof body.difficulty === 'string' ? body.difficulty : undefined,
      probeType: typeof body.probeType === 'string' ? body.probeType : undefined,
    });

    return apiSuccess({ probe });
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError('INVALID_REQUEST', error.status, error.message, error.code);
    }
    if (isAnotherMe2GatewayError(error)) {
      const message =
        error.status === 400 && /No knowledge tracing state found/i.test(error.message)
          ? '当前用户还没有知识追踪数据，暂时无法生成诊断题。请先完成一次练习或答题后再试。'
          : error.message;
      return apiError('INVALID_REQUEST', error.status, message);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to generate diagnostic probe',
    );
  }
}
