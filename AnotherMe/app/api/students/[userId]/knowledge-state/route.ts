import { NextRequest } from 'next/server';
import {
  getGatewayStudentKnowledgeContext,
  getGatewayStudentKnowledgeState,
  getGatewayStudentKnowledgeStates,
  getGatewayTeachingDecision,
  getGatewayTeachingDecisions,
  isAnotherMe2GatewayError,
} from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

function parseBooleanParam(value: string | null, defaultValue: boolean): boolean {
  if (value == null) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  return defaultValue;
}

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
    const knowledgePointId = request.nextUrl.searchParams.get('knowledgePointId')?.trim();

    const includeDecision = parseBooleanParam(
      request.nextUrl.searchParams.get('includeDecision'),
      true,
    );
    const includeContext = parseBooleanParam(
      request.nextUrl.searchParams.get('includeContext'),
      false,
    );

    if (knowledgePointId) {
      const state = await getGatewayStudentKnowledgeState({
        userId,
        knowledgePointId,
      });

      const response: Record<string, unknown> = { state };
      if (includeDecision) {
        response.decision = await getGatewayTeachingDecision({ userId, knowledgePointId });
      }
      if (includeContext) {
        response.context = await getGatewayStudentKnowledgeContext({ userId, knowledgePointId });
      }
      return apiSuccess(response);
    }

    const rawMinMastery = request.nextUrl.searchParams.get('minMastery');
    const parsedMinMastery = rawMinMastery == null ? undefined : Number(rawMinMastery);
    const minMastery = Number.isFinite(parsedMinMastery) ? parsedMinMastery : undefined;

    const rawLimit = Number(request.nextUrl.searchParams.get('limit') || '200');
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, rawLimit)) : 200;

    const states = await getGatewayStudentKnowledgeStates({
      userId,
      minMastery,
      limit,
    });

    const response: Record<string, unknown> = { states };
    if (includeDecision) {
      response.decisions = await getGatewayTeachingDecisions({
        userId,
        knowledgePointIds: states.map((item) => item.knowledge_point_id),
      });
    }

    return apiSuccess(response);
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
      error instanceof Error ? error.message : 'Failed to load student knowledge state',
    );
  }
}
