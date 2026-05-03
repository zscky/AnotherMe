import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { loginAndCreateSession } from '@/lib/auth/service';
import { AuthError } from '@/lib/auth/types';
import { attachSessionCookie } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
    };

    const email = (body.email || '').trim();
    const password = body.password || '';
    if (!email || !password) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'email and password are required');
    }

    // Use loginAndCreateSession to prevent session fixation attacks
    // This revokes all existing sessions before creating a new one
    const { user, session } = await loginAndCreateSession(email, password);

    const response = apiSuccess({ user });
    attachSessionCookie(response, session);
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError('INVALID_REQUEST', error.status, error.message, error.code);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to login',
    );
  }
}
