import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { deleteTrack, updateEditedTrack, type EditorInput } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

/** Privé (éditeur, #1340). `PUT /api/tracks/<slug>` : met à jour en place une trace de l'utilisateur (403 sinon : faire une copie). */
export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const input = (await req.json().catch(() => null)) as EditorInput | null;
  if (!input || typeof input !== 'object') return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const res = await updateEditedTrack(getDb().db, user.id, (await params).slug, input);
  if ('errors' in res) return Response.json({ errors: res.errors }, { status: 422 });
  if ('error' in res) {
    return Response.json({ error: res.error }, { status: res.error === 'forbidden' ? 403 : 404 });
  }
  return Response.json({ slug: res.slug });
}

/** Privé (#1449). `DELETE /api/tracks/<slug>` : supprime une trace de l'utilisateur (403 si elle n'est pas à lui ou vient d'une source externe). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const res = deleteTrack(getDb().db, user.id, (await params).slug);
  if ('error' in res) return Response.json({ error: res.error }, { status: res.error === 'forbidden' ? 403 : 404 });
  return Response.json({ ok: true });
}
