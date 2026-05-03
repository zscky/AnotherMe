import 'server-only';

import { randomBytes, randomUUID } from 'crypto';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { queryRows, withAuthDatabase } from '@/lib/auth/sqlite';
import { AuthError, type AuthSession, type AuthUser } from '@/lib/auth/types';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: number;
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: number;
}

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

function assertEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AuthError('INVALID_EMAIL', '邮箱格式不正确。', 400);
  }
}

function assertPassword(password: string) {
  const length = password.length;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw new AuthError(
      'INVALID_PASSWORD',
      `密码长度需要在 ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} 个字符之间。`,
      400,
    );
  }
}

function sanitizeDisplayName(displayName: string, email: string): string {
  const value = displayName.trim();
  if (value.length >= 2 && value.length <= 40) return value;
  return normalizeEmail(email).split('@')[0] || '同学';
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function getUserByEmail(email: string): Promise<UserRow | null> {
  return withAuthDatabase((db) => {
    const rows = queryRows<UserRow>(
      db,
      `SELECT id, email, display_name, password_hash, created_at
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [normalizeEmail(email)],
    );
    return rows[0] ?? null;
  });
}

export async function registerUser(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthUser> {
  const email = normalizeEmail(input.email);
  const password = input.password;
  const displayName = sanitizeDisplayName(input.displayName ?? '', email);

  assertEmail(email);
  assertPassword(password);

  const existing = await getUserByEmail(email);
  if (existing) {
    throw new AuthError('EMAIL_ALREADY_EXISTS', '该邮箱已被注册。', 409);
  }

  return withAuthDatabase(
    (db) => {
      const now = Date.now();
      const userId = randomUUID();
      db.run(
        `INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, email, displayName, hashPassword(password), now, now],
      );

      return {
        id: userId,
        email,
        displayName,
        createdAt: new Date(now).toISOString(),
      } satisfies AuthUser;
    },
    { persist: true },
  );
}

export async function authenticateUser(email: string, password: string): Promise<AuthUser> {
  const normalizedEmail = normalizeEmail(email);
  assertEmail(normalizedEmail);
  assertPassword(password);

  const row = await getUserByEmail(normalizedEmail);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AuthError('INVALID_CREDENTIALS', '邮箱或密码错误。', 401);
  }

  return toAuthUser(row);
}

/**
 * Authenticate user and create a new session.
 * This function revokes all existing sessions for the user to prevent session fixation attacks.
 * 
 * @param email - User email
 * @param password - User password
 * @returns Object containing user and new session
 */
export async function loginAndCreateSession(
  email: string,
  password: string,
): Promise<{ user: AuthUser; session: AuthSession }> {
  const user = await authenticateUser(email, password);

  // Revoke all existing sessions for this user to prevent session fixation
  await revokeAllUserSessions(user.id);

  // Create a new session
  const session = await createSession(user.id);

  return { user, session };
}

/**
 * Revoke all sessions for a user.
 * This should be called after successful authentication to prevent session fixation attacks.
 * 
 * @param userId - User ID
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  if (!userId) return;
  await withAuthDatabase(
    (db) => {
      db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    },
    { persist: true },
  );
}

export async function createSession(userId: string): Promise<AuthSession> {
  return withAuthDatabase(
    (db) => {
      const now = Date.now();
      const sessionId = randomBytes(24).toString('base64url');
      const expiresAt = now + SESSION_TTL_MS;

      db.run(
        `INSERT INTO sessions (id, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
        [sessionId, userId, now, expiresAt],
      );

      return {
        id: sessionId,
        userId,
        expiresAt,
      } satisfies AuthSession;
    },
    { persist: true },
  );
}

export async function getUserBySession(sessionId: string): Promise<AuthUser | null> {
  if (!sessionId) return null;
  const now = Date.now();

  let shouldPersist = false;
  const user = await withAuthDatabase((db) => {
    const rows = queryRows<UserRow>(
      db,
      `SELECT u.id, u.email, u.display_name, u.password_hash, u.created_at
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ?
         AND s.expires_at > ?
       LIMIT 1`,
      [sessionId, now],
    );

    if (rows.length > 0) {
      return toAuthUser(rows[0]);
    }

    const expired = queryRows<SessionRow>(
      db,
      `SELECT id, user_id, expires_at
       FROM sessions
       WHERE id = ?
       LIMIT 1`,
      [sessionId],
    )[0];
    if (expired && expired.expires_at <= now) {
      db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
      shouldPersist = true;
    }

    return null;
  });

  if (shouldPersist) {
    await withAuthDatabase(
      () => {
        // no-op: flush pending expired-session deletion
      },
      { persist: true },
    );
  }

  return user;
}

export async function revokeSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  await withAuthDatabase(
    (db) => {
      db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    },
    { persist: true },
  );
}
