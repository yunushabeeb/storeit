import { getRedis } from '@/lib/redis';

// One round trip so the counter and its expiry cannot drift apart. A plain
// INCR followed by EXPIRE is two commands; a crash between them leaves a key
// that never expires and permanently blocks the email.
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
) {
  const redis = await getRedis();
  const namespaced = `storeit:rl:${key}`;
  const count = Number(
    await redis.eval(
      `
        local current = redis.call('INCR', KEYS[1])
        if current == 1 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return current
      `,
      { keys: [namespaced], arguments: [String(windowSeconds)] },
    ),
  );

  return {
    allowed: count <= limit,
    retryAfter: Math.max(await redis.ttl(namespaced), 0),
  };
}

// Five codes per email per 15 minutes. The limit is on the address, not on
// whether an account exists, so the response does not reveal who is registered.
export async function enforceOtpSendLimit(email: string) {
  const result = await consumeRateLimit(`otp:${email}`, 5, 15 * 60);

  if (!result.allowed) {
    return 'Too many codes requested. Try again later.';
  }

  return null;
}
