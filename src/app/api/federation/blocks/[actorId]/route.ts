import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { blockActor, unblockActor } from '@/lib/federation/moderation';

export const dynamic = 'force-dynamic';

/** Privé (#1477). Bloque un compte d'un autre serveur : plus de demande de copain ni d'invitation de sa part. */
export async function POST(_req: Request, { params }: { params: Promise<{ actorId: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  return blockActor(getDb().db, user.id, (await params).actorId) ? Response.json({ ok: true }) : Response.json({ error: 'not_found' }, { status: 404 });
}

/** Privé. Débloque un compte (ses demandes pourront de nouveau arriver). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ actorId: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  unblockActor(getDb().db, user.id, (await params).actorId);
  return Response.json({ ok: true });
}
