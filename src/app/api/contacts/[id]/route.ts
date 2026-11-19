import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { updateContact } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Private. `{ name?, note?, archived? }`: rename, annotate, archive / restore (the history is kept). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const r = updateContact(getDb().db, user.id, (await params).id, body ?? {});
  if (r.ok) return Response.json({ ok: true });
  return Response.json({ error: r.error, errors: r.errors }, { status: r.error === 'not_found' ? 404 : 422 });
}
