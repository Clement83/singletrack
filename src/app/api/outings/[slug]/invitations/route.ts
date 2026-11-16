import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { createInvitation } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Privé. Crée une invitation nominative ; le token (donc le lien) n'est renvoyé que cette fois. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const res = createInvitation(getDb().db, user.id, (await params).slug, body?.name);
  if (res.ok) return Response.json({ id: res.id, token: res.token, path: `/i/${res.token}` }, { status: 201 });
  return Response.json({ error: res.error, errors: res.errors }, { status: res.error === 'not_found' ? 404 : 422 });
}
