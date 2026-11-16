import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { getInvitationLink, revokeInvitation } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Privé. `{ action: 'revoke' }`. Jamais de régénération (#1456). */
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

/** Privé. `GET` : lien perso déchiffré `{ path: '/i/<token>' }` (#1456) ; 410 `linkUnavailable` pour un lien créé avant le chiffrement. */
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
