import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { parseSegmentsQuery, querySegments } from '@/lib/osm/singles-store';
import { OSM_ATTRIBUTION, OSM_LICENSE } from '@/lib/osm';

export const dynamic = 'force-dynamic';

/**
 * Privé (connecté) : calque des singles OSM (#1372).
 * `GET /api/tracks/segments?bbox=minLon,minLat,maxLon,maxLat&zoom=13` → FeatureCollection (difficulté, `mtb:scale`),
 * géométrie simplifiée selon le zoom, volume plafonné. Sous le zoom minimal : `status: "zoom_in"`, aucune donnée.
 */
export async function GET(req: Request) {
  try {
    await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const q = parseSegmentsQuery(new URL(req.url).searchParams);
  if (!q) return Response.json({ error: 'bbox et zoom requis' }, { status: 400 });
  const res = querySegments(getDb().db, q.bbox, q.zoom);
  return Response.json({ type: 'FeatureCollection', license: OSM_LICENSE, attribution: OSM_ATTRIBUTION, ...res });
}
