import { getDb } from '@/db';
import { addDays, parisDate } from '@/lib/fire';
import { assertUser, unauthorized } from '@/lib/current-user';
import { readCacheHeaders, readViewer } from '@/lib/public-read';
import { config } from '@/lib/config';
import { createEditedTrack, parseFilters, queryTracks, type EditorInput } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/tracks?starts=1` est lisible **sans session** (#1589, traces publiques seulement) ; le reste est privé (connecté) : `GET /api/tracks?bbox=minLon,minLat,maxLon,maxLat&q=&minKm=&maxKm=&minGain=&maxGain=
 * &difficulty=green,blue&shape=loop|oneway&near=20&mine=1&access=today|tomorrow&overview=1|starts=1`. Géométrie simplifiée ; plafonnée (les plus proches du centre
 * de `bbox` d'abord), `total` = nombre avant plafond (#1428).
 */
export async function GET(req: Request) {
  const { user, rejected } = await readViewer(req);
  if (rejected) return rejected;
  const sp = new URL(req.url).searchParams;
  // Sans session (#1589) : seulement les départs de la carte (`starts=1`), jamais « mes traces » ; le reste exige une session.
  if (!user && (sp.get('starts') !== '1' || sp.get('mine') === '1')) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const filters = parseFilters(sp);
  // `overview=1` (zoom d'ensemble) : points de départ seulement, sans géométrie (#1428).
  const overview = sp.get('overview') === '1';
  // `starts=1` (#1530) : départs légers (sans géométrie ni bbox) à tout zoom, plafond relevé ; la géométrie se
  // charge ensuite à la demande par `/api/tracks/geometry?slugs=`.
  const starts = sp.get('starts') === '1';
  const today = parisDate(new Date());
  const openOn = filters.access ? (filters.access === 'today' ? today : addDays(today, 1)) : undefined;
  const { tracks, total } = queryTracks(getDb().db, filters, { lat: config.homeLat, lon: config.homeLon }, { openOn, overview, starts, userId: user?.id });
  if (starts) {
    const light = tracks.map((t) => ({ slug: t.slug, name: t.name, source: t.source, difficulty: t.difficulty, loop: t.loop, distanceKm: t.distanceKm, gainM: t.gainM, start: t.start, status: t.status }));
    return Response.json({ count: light.length, total, truncated: total > light.length, tracks: light }, { headers: readCacheHeaders(!user, 30) });
  }
  return Response.json({ count: tracks.length, total, truncated: total > tracks.length, tracks }, { headers: readCacheHeaders(false, 0) });
}

/**
 * Privé (éditeur, #1340). `POST /api/tracks` crée une trace (`{ name, description, geometry, waypoints, modes,
 * parentSlug? }`) : maison, ou copie modifiée si `parentSlug` est donné. Altitude manquante complétée par l'IGN.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const input = (await req.json().catch(() => null)) as EditorInput | null;
  if (!input || typeof input !== 'object') return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const res = await createEditedTrack(getDb().db, user.id, input);
  if ('errors' in res) return Response.json({ errors: res.errors }, { status: 422 });
  if ('error' in res) return Response.json({ error: res.error }, { status: 404 });
  return Response.json({ slug: res.slug }, { status: 201 });
}
