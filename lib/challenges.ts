import { getRedis } from '@/lib/redis';

const CHALLENGE_SECONDS = 10 * 60;

// The browser receives the challenge id as accountId. It is not the user id.
// userId stays null when the email has no account, so the later code check
// can fail the same way it fails for a wrong code.
export type LoginChallenge = {
  email: string;
  userId: string | null;
  attempts: number;
};

function key(id: string) {
  return `storeit:login:${id}`;
}

export async function saveLoginChallenge(id: string, challenge: LoginChallenge) {
  const redis = await getRedis();

  // SET with EX refreshes the 10-minute lifetime on every attempt write.
  // An abandoned challenge disappears on its own if Redis is flushed; the
  // session, which is the durable login, lives in Postgres instead.
  await redis.set(key(id), JSON.stringify(challenge), { EX: CHALLENGE_SECONDS });
}

export async function readLoginChallenge(id: string) {
  const redis = await getRedis();
  const raw = await redis.get(key(id));

  if (!raw) return null;

  return JSON.parse(raw) as LoginChallenge;
}

export async function deleteLoginChallenge(id: string) {
  const redis = await getRedis();

  await redis.del(key(id));
}
