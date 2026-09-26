'use server';

// Sign-in is split across Redis (the challenge the browser holds), Postgres
// (the user, the code hash, the session), and the mail provider. Those three
// cannot share one transaction. Each step below commits its own store, and
// the next step is written so a failure does not reveal whether the email exists.

import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { avatarPlaceholderUrl } from '@/constants';
import {
  createUserSession,
  destroyAllSessions,
  destroySession,
  findUserByEmail,
  getSessionUser,
  hashOtp,
  hashesMatch,
  issueEmailOtp,
  toPublicUser,
  verifyEmailOtp,
} from '@/lib/auth';
import {
  deleteLoginChallenge,
  readLoginChallenge,
  saveLoginChallenge,
} from '@/lib/challenges';
import { getDb } from '@/lib/db';
import { enforceOtpSendLimit } from '@/lib/rate-limit';
import { parseStringify } from '@/lib/utils';

const handleError = (error: unknown, message: string) => {
  console.error(error, message);
  throw error;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

// Returns the challenge id under the name accountId because the form was
// built against that field. The id is random and expires with the challenge.
async function beginLogin(email: string, userId: string | null) {
  const challengeId = randomUUID();

  await saveLoginChallenge(challengeId, { email, userId, attempts: 0 });

  return parseStringify({ accountId: challengeId });
}

export const sendEmailOTP = async ({ email }: { email: string }) => {
  const normalizedEmail = normalizeEmail(email);
  const limited = await enforceOtpSendLimit(normalizedEmail);

  if (limited) return parseStringify({ error: limited });

  const user = await findUserByEmail(normalizedEmail);

  // Resend is only offered after a real sign-in, which already required an
  // account. If the account disappeared, say so instead of pretending a code went out.
  if (!user) {
    return parseStringify({ error: 'Create an account to get a code.' });
  }

  await issueEmailOtp(user);

  return parseStringify({ ok: true });
};

export const createAccount = async ({
  fullName,
  email,
}: {
  fullName: string;
  email: string;
}) => {
  const normalizedEmail = normalizeEmail(email);
  const limited = await enforceOtpSendLimit(normalizedEmail);

  if (limited) return parseStringify({ accountId: null, error: limited });

  const existingUser = await findUserByEmail(normalizedEmail);

  // Sign-up with an existing email is a sign-in. Telling the person the
  // account already exists would confirm the address is registered.
  if (existingUser) {
    await issueEmailOtp(existingUser);
    return beginLogin(normalizedEmail, existingUser.id);
  }

  const accountId = randomUUID();

  try {
    await getDb()`
      INSERT INTO users (id, email, full_name, avatar)
      VALUES (
        ${accountId},
        ${normalizedEmail},
        ${fullName.trim()},
        ${avatarPlaceholderUrl}
      )
    `;

    try {
      await issueEmailOtp({
        id: accountId,
        email: normalizedEmail,
        full_name: fullName.trim(),
        avatar: avatarPlaceholderUrl,
        created_at: new Date(),
        updated_at: new Date(),
      });
    } catch (error) {
      // The mail send sits outside the database. If it fails, remove the user
      // so a half-created account is not left behind with no way to sign in.
      // email_otps references users with ON DELETE CASCADE, so the code row goes too.
      await getDb()`DELETE FROM users WHERE id = ${accountId}`;
      throw error;
    }

    return beginLogin(normalizedEmail, accountId);
  } catch (error) {
    // 23505 is a unique violation. Two sign-ups for the same email can pass
    // the lookup above and one insert then loses. Treat the loser as a sign-in.
    if (error instanceof postgres.PostgresError && error.code === '23505') {
      const user = await findUserByEmail(normalizedEmail);

      if (!user) throw error;

      await issueEmailOtp(user);
      return beginLogin(normalizedEmail, user.id);
    }

    handleError(error, 'Failed to create account');
  }
};

export const verifySecret = async ({
  accountId,
  password,
}: {
  accountId: string;
  password: string;
}) => {
  try {
    const challenge = await readLoginChallenge(accountId);

    // A missing challenge and a burned challenge must not share a message that
    // tells the client which of the two it is, except for the attempt limit,
    // which the person needs in order to request a new code.
    if (!challenge || challenge.attempts >= 5) {
      if (challenge) await deleteLoginChallenge(accountId);
      return parseStringify({
        sessionId: null,
        error: challenge
          ? 'Too many attempts. Request a new code.'
          : 'Invalid or expired code',
      });
    }

    // No account for this email. Spend the same hash comparison a real code
    // would, then fail with the same message, so timing and wording stay aligned.
    if (!challenge.userId) {
      hashesMatch(hashOtp('000000'), hashOtp(password));
      await saveLoginChallenge(accountId, {
        ...challenge,
        attempts: challenge.attempts + 1,
      });
      return parseStringify({ sessionId: null, error: 'Invalid or expired code' });
    }

    await verifyEmailOtp(challenge.userId, password);
    const sessionId = await createUserSession(challenge.userId);
    await deleteLoginChallenge(accountId);

    return parseStringify({ sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    // Only the two messages raised on purpose reach the client. A database
    // error would otherwise leak into the form.
    const safe =
      message === 'Invalid or expired code' || message.startsWith('Too many attempts')
        ? message
        : 'Failed to verify email OTP';

    return parseStringify({ sessionId: null, error: safe });
  }
};

export const getCurrentUser = async () => {
  try {
    const user = await getSessionUser();

    if (!user) return null;

    return parseStringify(toPublicUser(user));
  } catch (error) {
    console.error(error, 'Failed to get current user');
    return null;
  }
};

async function endSession(destroy: () => Promise<void>) {
  try {
    await destroy();
  } catch (error) {
    // The cookie is what the browser will send next. Clear it even when the
    // database delete failed, so this browser is signed out regardless.
    console.error(error, 'Failed to sign out user');
    (await cookies()).delete('storeit-session');
  } finally {
    redirect('/sign-in');
  }
}

export const signOutUser = async () => {
  await endSession(destroySession);
};

export const signOutEverywhere = async () => {
  await endSession(destroyAllSessions);
};

export const signInUser = async ({ email }: { email: string }) => {
  try {
    const normalizedEmail = normalizeEmail(email);
    const limited = await enforceOtpSendLimit(normalizedEmail);

    if (limited) return parseStringify({ accountId: null, error: limited });

    const existingUser = await findUserByEmail(normalizedEmail);

    // No account yet. The form sends them to sign-up with this address filled
    // in, instead of asking for a code that can never succeed.
    if (!existingUser) {
      return parseStringify({ accountId: null, needsAccount: true });
    }

    await issueEmailOtp(existingUser);

    return beginLogin(normalizedEmail, existingUser.id);
  } catch (error) {
    handleError(error, 'Failed to sign in user');
  }
};
