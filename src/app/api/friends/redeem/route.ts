import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { redeemInvite } from '@/lib/friends';
import { rateLimit } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Private. `{ token }`: accepts a friend invitation link (single use). */
export async function POST(req: Request) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  if (!rateLimit(`friend-redeem:${user.id}`, 20, 3600_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  if (typeof body?.token !== 'string') return Response.json({ error: 'not_found' }, { status: 404 });
  const r = redeemInvite(getDb().db, user.id, body.token);
  if (r.ok) return Response.json({ ok: true });
  return Response.json({ error: r.error }, { status: r.error === 'not_found' ? 404 : 422 });
}
