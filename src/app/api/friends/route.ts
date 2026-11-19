import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { listFriends, requestByEmail } from '@/lib/friends';
import { requestByAddress } from '@/lib/federation/friends';
import { rateLimit } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Private. My friends, received and sent requests (first names only). */
export async function GET() {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  return Response.json(listFriends(getDb().db, user.id));
}

/**
 * Private. `{ email }` or `{ address }` (`paul@other-server`, #1475): friend request. Same answer whether the account exists or not.
 * `address` requires `FEDERATION=on` (422 `federationOff` otherwise).
 */
export async function POST(req: Request) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  if (!rateLimit(`friend-req:${user.id}`, 20, 3600_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { email?: unknown; address?: unknown } | null;
  const r = body && 'address' in body ? await requestByAddress(getDb().db, user.id, body.address) : requestByEmail(getDb().db, user.id, body?.email);
  return r.ok ? Response.json({ ok: true }, { status: 202 }) : Response.json({ error: r.error }, { status: 422 });
}
