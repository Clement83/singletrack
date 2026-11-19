import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { linkContact } from '@/lib/friends';

export const dynamic = 'force-dynamic';

/** Private. `{ userId: string | null }` or `{ remoteActorId }` (friend on another server, #1475): links the buddy to an accepted friend (or unlinks with `null`). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const body = (await req.json().catch(() => null)) as { userId?: unknown; remoteActorId?: unknown } | null;
  if (!body || !('userId' in body || 'remoteActorId' in body)) return Response.json({ error: 'invalid' }, { status: 422 });
  const r = linkContact(getDb().db, user.id, (await params).id, body.userId ?? null, body.remoteActorId);
  if (r.ok) return Response.json({ ok: true });
  return Response.json({ error: r.error }, { status: r.error === 'not_found' ? 404 : 422 });
}
