import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { blockActor, unblockActor } from '@/lib/federation/moderation';

export const dynamic = 'force-dynamic';

/** Private (#1477). Blocks an account on another server: no more friend requests or invitations from it. */
export async function POST(_req: Request, { params }: { params: Promise<{ actorId: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  return blockActor(getDb().db, user.id, (await params).actorId) ? Response.json({ ok: true }) : Response.json({ error: 'not_found' }, { status: 404 });
}

/** Private. Unblocks an account (its requests may arrive again). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ actorId: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  unblockActor(getDb().db, user.id, (await params).actorId);
  return Response.json({ ok: true });
}
