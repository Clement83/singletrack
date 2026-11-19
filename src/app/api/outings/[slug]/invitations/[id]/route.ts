import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { getInvitationLink, revokeInvitation } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Private. `{ action: 'revoke' }`. Never regenerated (#1456). */
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  const { slug, id } = await params;
  const { db } = getDb();
  if (body?.action === 'revoke') {
    const r = revokeInvitation(db, user.id, slug, id);
    return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: 404 });
  }
  return Response.json({ error: 'unknownAction' }, { status: 400 });
}

/** Private. `GET`: decrypted personal link `{ path: '/i/<token>' }` (#1456); 410 `linkUnavailable` for a link created before encryption. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const { slug, id } = await params;
  const r = getInvitationLink(getDb().db, user.id, slug, id);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.error === 'linkUnavailable' ? 410 : 404 });
  return Response.json({ path: `/i/${r.token}` });
}
