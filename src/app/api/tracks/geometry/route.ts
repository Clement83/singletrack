import { getDb } from '@/db';
import { readCacheHeaders, readViewer } from '@/lib/public-read';
import { GEOMETRY_MAX_SLUGS, getTrackGeometries } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

/**
 * Readable **without a session** (#1589: public tracks only; signed in: according to visibility). (#1530) `GET /api/tracks/geometry?slugs=a,b,c&z=12`: simplified geometries (by zoom `z`) of
 * tracks designated by slug, on demand after `GET /api/tracks?starts=1`. Other people's drafts and unknown slugs are
 * left out. Private HTTP cache validated by ETag (slugs + `updatedAt`).
 */
export async function GET(req: Request) {
  const { user, rejected } = await readViewer(req);
  if (rejected) return rejected;
  const sp = new URL(req.url).searchParams;
  const slugs = [...new Set((sp.get('slugs') ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (!slugs.length || slugs.length > GEOMETRY_MAX_SLUGS) return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const zRaw = sp.get('z');
  const z = zRaw === null ? undefined : Number(zRaw);
  if (z !== undefined && !Number.isFinite(z)) return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const { tracks, version } = getTrackGeometries(getDb().db, slugs, user?.id, z);
  // "Friends" tracks / drafts depend on the user: private cache when signed in; public for an anonymous visitor.
  const etag = `"${Buffer.from(`${z ?? ''}|${user ? 'u' : 'a'}|${version}`).toString('base64url').slice(0, 200)}"`;
  const headers = { ETag: etag, ...readCacheHeaders(!user) };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return Response.json({ tracks }, { headers });
}
