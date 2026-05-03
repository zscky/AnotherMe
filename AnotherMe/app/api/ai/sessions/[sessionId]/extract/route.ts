import { NextRequest } from 'next/server';
import {
  createLearningRecordExtractJob,
  isAnotherMe2GatewayError,
  listGatewayAISessions,
} from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    if (!sessionId) {
      return apiError('INVALID_REQUEST', 400, 'Missing session id');
    }

    const body = (await request.json().catch(() => ({}))) as {
      userId?: string;
      extractVersion?: string;
      latestUserMessageId?: string;
      messageCount?: number;
    };
    const userId = await resolveRequestUserId(request, body.userId);

    const ownedSessions = await listGatewayAISessions({
      userId,
      limit: 1000,
    });
    const ownsSession = ownedSessions.some((session) => session.session_id === sessionId);
    if (!ownsSession) {
      return apiError('INVALID_REQUEST', 403, 'Session is not accessible');
    }

    const job = await createLearningRecordExtractJob({
      sessionId,
      userId,
      extractVersion: body.extractVersion,
      latestUserMessageId: body.latestUserMessageId,
      messageCount: body.messageCount,
    });

    return apiSuccess(
      {
        jobId: job.job_id,
        status: job.status,
        step: job.step,
        progress: job.progress,
      },
      202,
    );
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
      error instanceof Error ? error.message : 'Failed to enqueue learning extract job',
    );
  }
}
