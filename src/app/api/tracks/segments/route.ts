import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { parseSegmentsQuery, querySegments } from '@/lib/osm/singles-store';
import { OSM_ATTRIBUTION, OSM_LICENSE } from '@/lib/osm';

export const dynamic = 'force-dynamic';

/**
 * Private (signed in): OSM singletrack layer (#1372).
 * `GET /api/tracks/segments?bbox=minLon,minLat,maxLon,maxLat&zoom=13` → FeatureCollection (difficulty, `mtb:scale`),
 * geometry simplified by zoom, capped volume. Below the minimum zoom: `status: "zoom_in"`, no data.
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
