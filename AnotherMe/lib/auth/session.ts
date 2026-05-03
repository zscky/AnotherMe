import 'server-only';

import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { getUserBySession, revokeSession } from '@/lib/auth/service';
import { AuthError, type AuthUser } from '@/lib/auth/types';

export const AUTH_SESSION_COOKIE = 'anotherme_session';

function isSecureCookie() {
  const explicit = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

export function attachSessionCookie(response: NextResponse, session: { id: string; expiresAt: number }) {
  response.cookies.set(AUTH_SESSION_COOKIE, session.id, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: 'lax',
    path: '/',
    expires: new Date(session.expiresAt),
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
  });
}

export function getSessionIdFromRequest(request: NextRequest): string | null {
  return request.cookies.get(AUTH_SESSION_COOKIE)?.value ?? null;
}

export async function getSessionIdFromCookieStore(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_SESSION_COOKIE)?.value ?? null;
}

export async function getAuthenticatedUserFromRequest(
  request: NextRequest,
): Promise<AuthUser | null> {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) return null;
  return getUserBySession(sessionId);
}

export async function getAuthenticatedUserFromCookieStore(): Promise<AuthUser | null> {
  const sessionId = await getSessionIdFromCookieStore();
  if (!sessionId) return null;
  return getUserBySession(sessionId);
}

export async function requireAuthenticatedUserFromRequest(request: NextRequest): Promise<AuthUser> {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    throw new AuthError('UNAUTHORIZED', '未登录或登录状态已过期。', 401);
  }
  return user;
}

export async function clearRequestSession(request: NextRequest): Promise<void> {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) return;
  await revokeSession(sessionId);
}
