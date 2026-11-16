import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { createContact, listContacts } from '@/lib/outings';

export const dynamic = 'force-dynamic';

const view = (c: ReturnType<typeof listContacts>[number]) => ({
  id: c.id, name: c.name, note: c.note, outings: c.outings, lastOutingAt: c.lastOutingAt?.toISOString() ?? null, linked: !!c.userId,
});

/** Privé. Carnet de potes de l'utilisateur (`?archived=1` pour les archivés). */
export async function GET(req: Request) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const archived = new URL(req.url).searchParams.get('archived') === '1';
  return Response.json({ contacts: listContacts(getDb().db, user.id, { archived }).map(view) });
}

/** Privé. `{ name, note? }` : ajoute un pote (un nom déjà présent est réutilisé, et désarchivé). */
export async function POST(req: Request) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const body = (await req.json().catch(() => null)) as { name?: unknown; note?: unknown } | null;
  const r = createContact(getDb().db, user.id, body ?? {});
  return r.ok ? Response.json({ id: r.id }, { status: 201 }) : Response.json({ error: r.error, errors: r.errors }, { status: 422 });
}
