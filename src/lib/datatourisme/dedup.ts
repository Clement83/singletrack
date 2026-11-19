import { and, gte, inArray, lte, ne, or, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { track } from '@/db/schema';
import { geometryStats, haversine, kmAlongTrack, type Position, type TrackGeometry } from '@/lib/geo';

/**
 * Duplicate rule (#1643): a DATAtourisme circuit is skipped when it and an existing track cover each other —
 * at least `DUP_SHARE` of the points of each one lie within `DUP_DISTANCE_M` of the other — whether the existing
 * track comes from another synced source (OSM, Geotrek, Utagawa) or from another DATAtourisme record (the same
 * route published by two producers). Mutual on purpose: a short loop that runs entirely on a longer circuit is a
 * different offer, not a duplicate. Points are sampled every `SAMPLE_STEP_M`.
 */
export const DUP_DISTANCE_M = 30;
export const DUP_SHARE = 0.8;
export const SAMPLE_STEP_M = 50;
const MAX_SAMPLES = 400;

const flatten = (g: TrackGeometry): Position[] => (g.type === 'LineString' ? g.coordinates : g.coordinates.flat());

/** Points every ~`step` metres along the geometry (always the first and last point). */
export function samplePoints(g: TrackGeometry, step = SAMPLE_STEP_M): Position[] {
  const pts = flatten(g);
  if (pts.length <= 2) return pts;
  const out: Position[] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += haversine(pts[i - 1], pts[i]);
    if (acc >= step) {
      out.push(pts[i]);
      acc = 0;
    }
  }
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  if (out.length <= MAX_SAMPLES) return out;
  const every = out.length / MAX_SAMPLES;
  return Array.from({ length: MAX_SAMPLES }, (_, i) => out[Math.floor(i * every)]);
}

/** Share (0–1) of the sampled points of `a` that lie within `maxM` metres of the line `b`. */
export function overlapShare(a: TrackGeometry, b: TrackGeometry, maxM = DUP_DISTANCE_M): number {
  const samples = samplePoints(a);
  if (!samples.length) return 0;
  let near = 0;
  for (const [lon, lat] of samples) {
    const r = kmAlongTrack(b, lon, lat);
    if (r && r.distM <= maxM) near++;
  }
  return near / samples.length;
}

/** Margin added around the bounding box when looking for candidates (degrees, ≈ 1 km). */
const BBOX_MARGIN = 0.01;

/**
 * Existing track that `geometry` duplicates, if any. `selfExternalId` excludes the DATAtourisme record being
 * updated. Only candidates whose bounding box overlaps are compared.
 */
export function findDuplicate(db: Db, geometry: TrackGeometry, selfExternalId: string): { id: string; source: string; name: string } | null {
  const s = geometryStats(geometry);
  if (!s.bbox) return null;
  const candidates = db
    .select({ id: track.id, source: track.source, name: track.name, geometry: track.geometry })
    .from(track)
    .where(
      and(
        inArray(track.source, ['osm', 'geotrek', 'utagawa', 'datatourisme']),
        or(isNull(track.externalId), ne(track.externalId, selfExternalId)),
        lte(track.bboxMinLon, s.bbox.maxLon + BBOX_MARGIN),
        gte(track.bboxMaxLon, s.bbox.minLon - BBOX_MARGIN),
        lte(track.bboxMinLat, s.bbox.maxLat + BBOX_MARGIN),
        gte(track.bboxMaxLat, s.bbox.minLat - BBOX_MARGIN),
      ),
    )
    .all();
  for (const c of candidates) {
    const other = c.geometry as TrackGeometry;
    if (overlapShare(geometry, other) >= DUP_SHARE && overlapShare(other, geometry) >= DUP_SHARE) return { id: c.id, source: c.source, name: c.name };
  }
  return null;
}
