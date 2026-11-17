import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { readCacheHeaders, readViewer } from '@/lib/public-read';
import { deleteTrack, setTrackVisibility, trackSheet, updateEditedTrack, type EditorInput } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

/**
 * Lecture **sans session** possible (#1589, trace publique seulement ; PUT/DELETE privés). (#1581) `GET /api/tracks/<slug>` : fiche complète (stats, géométrie à 5 m, profil, droits, sorties),
 * même calcul que la page `/t/<slug>`. Brouillon d'autrui ou slug inconnu ⇒ 404. Cache privé, ETag slug + `updatedAt`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { user, rejected } = await readViewer(req);
  if (rejected) return rejected;
  const sheet = await trackSheet(getDb().db, (await params).slug, user?.id);
  if (!sheet) return Response.json({ error: 'not_found' }, { status: 404 });
  const { updatedAt, ...body } = sheet;
  const etag = `"${Buffer.from(`${sheet.slug}:${updatedAt.getTime()}:${user?.id ?? 'anon'}:${body.outings.map((o) => o.slug).join(',')}`).toString('base64url').slice(0, 200)}"`;
  const headers = { ETag: etag, ...readCacheHeaders(!user) };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return Response.json(body, { headers });
}

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

/** Privé (#1590). `PATCH /api/tracks/<slug>` `{ visibility }` : change la visibilité d'une trace de l'utilisateur (403 si elle n'est pas à lui ou vient d'une source externe, 422 si la valeur est inconnue). */
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const body = (await req.json().catch(() => null)) as { visibility?: unknown } | null;
  if (!body || typeof body !== 'object') return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const res = setTrackVisibility(getDb().db, user.id, (await params).slug, body.visibility);
  if ('error' in res) return Response.json({ error: res.error }, { status: res.error === 'forbidden' ? 403 : res.error === 'invalid' ? 422 : 404 });
  return Response.json({ visibility: res.visibility });
}
