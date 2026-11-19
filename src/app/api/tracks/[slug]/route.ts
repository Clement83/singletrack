import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { readCacheHeaders, readViewer } from '@/lib/public-read';
import { deleteTrack, setTrackVisibility, trackSheet, updateEditedTrack, type EditorInput } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

/**
 * Readable **without a session** (#1589, public track only; PUT/DELETE private). (#1581) `GET /api/tracks/<slug>`: full sheet (stats, geometry at 5 m, profile, rights, outings),
 * same computation as the `/t/<slug>` page. Someone else's draft or unknown slug ⇒ 404. Private cache, ETag slug + `updatedAt`.
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

/** Private (editor, #1340). `PUT /api/tracks/<slug>`: updates a track of the user in place (403 otherwise: make a copy). */
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

/** Private (#1449). `DELETE /api/tracks/<slug>`: deletes a track of the user (403 if it is not theirs or comes from an external source). */
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

/** Private (#1590). `PATCH /api/tracks/<slug>` `{ visibility }`: changes the visibility of a track of the user (403 if it is not theirs or comes from an external source, 422 if the value is unknown). */
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
