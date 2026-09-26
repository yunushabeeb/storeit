import { createHash, timingSafeEqual } from 'node:crypto';
import { sweepOrphans } from '@/lib/object-retention';

export const dynamic = 'force-dynamic';

// Hashes both sides before the comparison so the check does not exit early
// on a shorter header. A missing secret fails closed rather than allowing
// an unauthenticated sweep.
function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  const header = request.headers.get('authorization') || '';

  if (!expected || !header) return false;

  const provided = createHash('sha256').update(header).digest();
  const actual = createHash('sha256').update(`Bearer ${expected}`).digest();

  return timingSafeEqual(provided, actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const result = await sweepOrphans();

  return Response.json(result);
}
