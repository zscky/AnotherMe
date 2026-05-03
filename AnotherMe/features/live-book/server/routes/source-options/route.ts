import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/session';
import { listGeneratedNoteOptions, listKbSourceOptions } from '../../live-book/source-registry';

function uniqueUserIds(...ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.map((id) => id?.trim()).filter(Boolean) as string[]));
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get('kind') || '';
    const queryUserId = url.searchParams.get('userId')?.trim();
    const sessionId = url.searchParams.get('sessionId')?.trim();
    const user = await getAuthenticatedUserFromRequest(req);
    const userId = queryUserId || user?.id || '';
    const fallbackUserIds = uniqueUserIds(userId, 'local-user', 'anonymous', 'anotherme-default-user');

    if (kind === 'notes') {
      const notes = await listGeneratedNoteOptions(fallbackUserIds);
      return apiSuccess({ notes });
    }

    if (kind === 'chat') {
      const { listGatewayAISessions } = await import('@/lib/server/anotherme2-gateway');
      const sessionGroups = await Promise.all(
        fallbackUserIds.map(async (candidateUserId) => {
          try {
            return await listGatewayAISessions({ userId: candidateUserId, limit: 30 });
          } catch {
            return [];
          }
        }),
      );
      const seen = new Set<string>();
      const sessions = sessionGroups
        .flat()
        .filter((session) => {
          if (seen.has(session.session_id)) return false;
          seen.add(session.session_id);
          return true;
        })
        .slice(0, 50);
      return apiSuccess({ sessions });
    }

    if (kind === 'chatMessages') {
      if (!sessionId) {
        return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: sessionId');
      }
      const { listGatewayAIMessages } = await import('@/lib/server/anotherme2-gateway');
      const messages = await listGatewayAIMessages({ sessionId, limit: 80 });
      return apiSuccess({ messages });
    }

    if (kind === 'kb') {
      const result = await listKbSourceOptions();
      return apiSuccess(result);
    }

    return apiError('INVALID_REQUEST', 400, 'Unsupported source option kind');
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to load live book source options',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
