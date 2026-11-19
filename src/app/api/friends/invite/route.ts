import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { createInviteLink } from '@/lib/friends';
import { rateLimit } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Private. Creates a single-use friend invitation link (the token is only returned this once). */
export async function POST() {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  if (!rateLimit(`friend-link:${user.id}`, 20, 3600_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
  return Response.json(createInviteLink(getDb().db, user.id), { status: 201 });
}
