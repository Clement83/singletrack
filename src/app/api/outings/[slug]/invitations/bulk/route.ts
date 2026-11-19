import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { inviteMany } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Private. `{ contactIds?: string[], newNames?: {name, addToBook?}[] }`: one named invitation per person.
 *  The tokens (hence the links) are only returned this once. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const body = (await req.json().catch(() => null)) as { contactIds?: unknown; newNames?: unknown } | null;
  const r = inviteMany(getDb().db, user.id, (await params).slug, body ?? {});
  if (r.ok) return Response.json({ invites: r.invites, skipped: r.skipped }, { status: 201 });
  return Response.json({ error: r.error, errors: r.errors }, { status: r.error === 'not_found' ? 404 : 422 });
}
