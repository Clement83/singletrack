import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { removeFederated, respondFederated } from '@/lib/federation/friends';

export const dynamic = 'force-dynamic';

/** Private. `{ action: 'accept' | 'decline' }`: answer a received request (recipient only). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  const r = await respondFederated(getDb().db, user.id, (await params).id, body?.action);
  if (r.ok) return Response.json({ ok: true });
  return Response.json({ error: r.error }, { status: r.error === 'not_found' ? 404 : 422 });
}

/** Private. Removes a friend or cancels a sent request. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const r = await removeFederated(getDb().db, user.id, (await params).id);
  return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: 404 });
}
