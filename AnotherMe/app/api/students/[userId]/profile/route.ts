import { NextRequest } from 'next/server';
import { getGatewayStudentProfile, isAnotherMe2GatewayError } from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId: routeUserId } = await context.params;
    if (!routeUserId) {
      return apiError('INVALID_REQUEST', 400, 'Missing user id');
    }

    const userId = await resolveRequestUserId(request, routeUserId);
    const rawLookback = Number(request.nextUrl.searchParams.get('lookbackDays') || '120');
    const lookbackDays = Number.isFinite(rawLookback) ? rawLookback : 120;

    const profile = await getGatewayStudentProfile({
      userId,
      lookbackDays,
    });
    return apiSuccess({ profile });
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
      error instanceof Error ? error.message : 'Failed to load student profile',
    );
  }
}
