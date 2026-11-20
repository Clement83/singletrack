import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { trailSegment } from '@/db/schema';
import { simplifyGeometry, type TrackGeometry } from '@/lib/geo';
import type { Difficulty } from '@/lib/tracks/difficulty';
import { SINGLES_MAX_FEATURES, SINGLES_MIN_ZOOM, toleranceForZoom, type TrailSegment } from './singles';

/**
 * Replaces the singletracks of an **area** (department, #1428) with the result of a sync, in a transaction:
 * idempotent, ways deleted from OSM disappear, and a sync that fails before reaching this point leaves the old
 * area untouched. A way on the border of two departments belongs to the last synced area (no duplicate:
 * `osm_id` is the key). Without `zone`, replaces the whole layer (old behaviour).
 */
export function replaceSegments(db: Db, segments: TrailSegment[], now = new Date(), zone: string | null = null): { count: number } {
  db.transaction((tx) => {
    if (zone === null) tx.delete(trailSegment).run();
    else tx.delete(trailSegment).where(eq(trailSegment.zone, zone)).run();
    for (let i = 0; i < segments.length; i += 200) {
      const batch = segments.slice(i, i + 200).map((s) => ({
        osmId: s.osmId,
        name: s.name,
        highway: s.highway,
        mtbScale: s.mtbScale,
        surface: s.surface,
        mtbScaleUphill: s.mtbScaleUphill,
        difficulty: s.difficulty,
        geometry: s.geometry,
        bboxMinLon: s.bbox.minLon,
        bboxMinLat: s.bbox.minLat,
        bboxMaxLon: s.bbox.maxLon,
        bboxMaxLat: s.bbox.maxLat,
        lengthM: s.lengthM,
        syncedAt: now,
        zone,
      }));
      if (batch.length)
        tx.insert(trailSegment).values(batch).onConflictDoUpdate({
          target: trailSegment.osmId,
          set: {
            name: sql`excluded.name`, highway: sql`excluded.highway`, mtbScale: sql`excluded.mtb_scale`, surface: sql`excluded.surface`, mtbScaleUphill: sql`excluded.mtb_scale_uphill`, difficulty: sql`excluded.difficulty`,
            geometry: sql`excluded.geometry`, bboxMinLon: sql`excluded.bbox_min_lon`, bboxMinLat: sql`excluded.bbox_min_lat`,
            bboxMaxLon: sql`excluded.bbox_max_lon`, bboxMaxLat: sql`excluded.bbox_max_lat`, lengthM: sql`excluded.length_m`,
            syncedAt: sql`excluded.synced_at`, zone: sql`excluded.zone`,
          },
        }).run();
    }
  });
  return { count: segments.length };
}

export type SegmentFeature = {
  type: 'Feature';
  properties: { id: string; difficulty: Difficulty | 'none'; scale: string; name: string | null; surface: string | null; uphill: string | null; lengthM: number };
  geometry: TrackGeometry;
};

export type SegmentsResult =
  | { status: 'ok'; truncated: boolean; features: SegmentFeature[] }
  /** Zoom too low: nothing is served, the interface asks to zoom in. */
  | { status: 'zoom_in'; features: [] };

/**
 * Segments crossing `bbox` ([minLon, minLat, maxLon, maxLat]), geometry simplified by zoom, at most
 * `SINGLES_MAX_FEATURES` (longest first: they are the most useful when cutting).
 */
export function querySegments(db: Db, bbox: [number, number, number, number], zoom: number): SegmentsResult {
  if (zoom < SINGLES_MIN_ZOOM) return { status: 'zoom_in', features: [] };
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const rows = db
    .select()
    .from(trailSegment)
    // R-tree spatial index (#1428): segments whose extent crosses the view, without scanning the table.
    .where(sql`${trailSegment}.rowid in (select id from trail_segment_rtree where max_lon >= ${minLon} and min_lon <= ${maxLon} and max_lat >= ${minLat} and min_lat <= ${maxLat})`)
    .orderBy(sql`${trailSegment.lengthM} desc`)
    .limit(SINGLES_MAX_FEATURES + 1)
    .all();
  const tol = toleranceForZoom(zoom);
  return {
    status: 'ok',
    truncated: rows.length > SINGLES_MAX_FEATURES,
    features: rows.slice(0, SINGLES_MAX_FEATURES).map((r) => ({
      type: 'Feature',
      properties: { id: r.osmId, difficulty: r.difficulty ?? 'none', scale: r.mtbScale, name: r.name, surface: r.surface, uphill: r.mtbScaleUphill, lengthM: r.lengthM },
      geometry: tol > 0 ? simplifyGeometry(r.geometry, tol) : r.geometry,
    })),
  };
}

/** Reads the `bbox` and `zoom` parameters of `GET /api/tracks/segments`; `null` if invalid. */
export function parseSegmentsQuery(sp: URLSearchParams): { bbox: [number, number, number, number]; zoom: number } | null {
  const parts = (sp.get('bbox') ?? '').split(',').map(Number);
  const rawZoom = sp.get('zoom');
  const zoom = rawZoom ? Number(rawZoom) : NaN;
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || !Number.isFinite(zoom)) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon > maxLon || minLat > maxLat || Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) return null;
  return { bbox: [minLon, minLat, maxLon, maxLat], zoom };
}
