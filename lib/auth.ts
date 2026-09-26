import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { getDb, type UserRow } from '@/lib/db';
import { sendOtpEmail } from '@/lib/mail';

const SESSION_COOKIE = 'storeit-session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_MS = 10 * 60 * 1000;
const OTP_ATTEMPT_LIMIT = 5;

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

// The code is never stored. The hash includes AUTH_SECRET so a database
// read does not let someone test codes offline without that secret.
export function hashOtp(code: string) {
  const secret = process.env.AUTH_SECRET;

  if (!secret) throw new Error('AUTH_SECRET is not set');

  return sha256(`${secret}:${code}`);
}

// timingSafeEqual throws when the buffers differ in length. The length check
// avoids that throw. A length mismatch is already a failed comparison.
export function hashesMatch(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

// The UI still speaks the field names it was built with ($id, fullName).
// This is the only place a database row becomes that shape.
export function toPublicUser(user: UserRow) {
  return {
    $id: user.id,
    accountId: user.id,
    email: user.email,
    fullName: user.full_name,
    avatar: user.avatar,
    $createdAt: iso(user.created_at),
    $updatedAt: iso(user.updated_at),
  };
}

export async function findUserByEmail(email: string) {
  const rows = await getDb()<UserRow[]>`
    SELECT id, email, full_name, avatar, created_at, updated_at
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

// cache() dedupes this lookup for the rest of the render. The dashboard calls
// it from the layout and again from each data function in the same request.
export const getSessionUser = cache(async function getSessionUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (!token) return null;

  const rows = await getDb()<UserRow[]>`
    SELECT u.id, u.email, u.full_name, u.avatar, u.created_at, u.updated_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)}
      AND s.expires_at > now()
    LIMIT 1
  `;

  return rows[0] ?? null;
});

export async function createUserSession(userId: string) {
  const token = randomBytes(32).toString('hex');
  const id = randomUUID();
  const expires = new Date(Date.now() + SESSION_MS);

  await getDb()`
    INSERT INTO sessions (id, user_id, token_hash, expires_at)
    VALUES (${id}, ${userId}, ${sha256(token)}, ${expires})
  `;

  (await cookies()).set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    // Secure cookies are dropped on http://localhost, so this is production only.
    secure: process.env.NODE_ENV === 'production',
    expires,
  });

  return id;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await getDb()`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`;
  }

  cookieStore.delete(SESSION_COOKIE);
}

export async function destroyAllSessions() {
  const user = await getSessionUser();
  const cookieStore = await cookies();

  if (user) {
    await getDb()`DELETE FROM sessions WHERE user_id = ${user.id}`;
  }

  cookieStore.delete(SESSION_COOKIE);
}

export async function issueEmailOtp(user: UserRow) {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const expires = new Date(Date.now() + OTP_MS);
  const sql = getDb();

  // Replacing the previous code and storing the new one commit together.
  // The email provider is not part of Postgres, so the send happens after the
  // commit. A failed send leaves a valid code; the next request replaces it.
  await sql.begin(async (tx) => {
    await tx`DELETE FROM email_otps WHERE user_id = ${user.id}`;
    await tx`
      INSERT INTO email_otps (user_id, code_hash, expires_at)
      VALUES (${user.id}, ${hashOtp(code)}, ${expires})
    `;
  });

  await sendOtpEmail(user.email, code);
}

export async function verifyEmailOtp(userId: string, code: string) {
  const candidate = hashOtp(code.trim());
  const sql = getDb();

  // Lock the code row so two submissions cannot both pass the attempt check
  // and both create a session. The increment and the success delete commit
  // with that lock.
  await sql.begin(async (tx) => {
    const rows = await tx<{ id: string; code_hash: string; attempts: number }[]>`
      SELECT id, code_hash, attempts
      FROM email_otps
      WHERE user_id = ${userId}
        AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `;
    const row = rows[0];

    if (!row) throw new Error('Invalid or expired code');

    if (row.attempts >= OTP_ATTEMPT_LIMIT) {
      await tx`DELETE FROM email_otps WHERE user_id = ${userId}`;
      throw new Error('Too many attempts. Request a new code.');
    }

    if (!hashesMatch(row.code_hash, candidate)) {
      await tx`
        UPDATE email_otps
        SET attempts = attempts + 1
        WHERE id = ${row.id}
      `;
      throw new Error('Invalid or expired code');
    }

    await tx`DELETE FROM email_otps WHERE user_id = ${userId}`;
  });
}
