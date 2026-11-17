import { getDb } from '@/db';
import { readCacheHeaders, readViewer } from '@/lib/public-read';
import { GEOMETRY_MAX_SLUGS, getTrackGeometries } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

/**
 * Lecture **sans session** possible (#1589 : traces publiques seulement ; connecté : selon visibilité). (#1530) `GET /api/tracks/geometry?slugs=a,b,c&z=12` : géométries simplifiées (selon le zoom `z`) de
 * traces désignées par slug, à la demande après `GET /api/tracks?starts=1`. Brouillons d'autrui et slugs inconnus
 * omis. Cache HTTP privé validé par ETag (slugs + `updatedAt`).
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
  // Les traces « copains » / brouillons dépendent de l'utilisateur : cache privé s'il est connecté ; public pour un anonyme.
  const etag = `"${Buffer.from(`${z ?? ''}|${user ? 'u' : 'a'}|${version}`).toString('base64url').slice(0, 200)}"`;
  const headers = { ETag: etag, ...readCacheHeaders(!user) };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return Response.json({ tracks }, { headers });
}
