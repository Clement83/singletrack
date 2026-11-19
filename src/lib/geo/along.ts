import { haversine } from './distance';
import type { Position, TrackGeometry } from './types';

export type AlongResult = {
  /** Distance (m) between the requested point and the track, at the closest pass. */
  distM: number;
  /** Km from the start at each pass close to the point (increasing): one, two for a loop or an out-and-back. */
  kms: number[];
  /** Index of the track vertex closest to the main pass (to find elevation / slope). */
  index: number;
};

/** Margin (m) around the closest pass: beyond it, another pass is no longer "at the same place". */
const PASS_TOLERANCE_M = 25;

const flatten = (g: TrackGeometry | Position[]): Position[] =>
  Array.isArray(g) ? g : g.type === 'LineString' ? g.coordinates : g.coordinates.flat();

/**
 * Km from the start at the track point closest to `[lon, lat]` (#1535). Projects the point onto each
 * edge (local equirectangular plane), then groups contiguous close edges into "passes": an out-and-back
 * or a loop that comes back to the same place thus returns two km values (« km 3,2 · km 28,4 »).
 * `totalKm` rescales when the geometry is simplified (real length known elsewhere).
 * Returns `null` for a track with fewer than 2 points.
 */
export function kmAlongTrack(geometry: TrackGeometry | Position[], lon: number, lat: number, totalKm?: number): AlongResult | null {
  const pts = flatten(geometry);
  if (pts.length < 2) return null;
  const k = Math.cos((lat * Math.PI) / 180);
  const M = 111_320;
  // For each edge: distance to the point (m) and curvilinear abscissa (m) of the projection.
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const dist: number[] = [];
  const at: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = (pts[i][0] - lon) * k * M, ay = (pts[i][1] - lat) * M;
    const bx = (pts[i + 1][0] - lon) * k * M, by = (pts[i + 1][1] - lat) * M;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    dist.push(Math.hypot(ax + t * dx, ay + t * dy));
    at.push(cum[i] + t * (cum[i + 1] - cum[i]));
  }
  const best = Math.min(...dist);
  const limit = best + PASS_TOLERANCE_M;
  const passes: { d: number; m: number; i: number }[] = [];
  let cur: { d: number; m: number; i: number } | null = null;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] <= limit) {
      if (!cur) cur = { d: dist[i], m: at[i], i };
      else if (dist[i] < cur.d) cur = { d: dist[i], m: at[i], i };
    } else if (cur) {
      passes.push(cur);
      cur = null;
    }
  }
  if (cur) passes.push(cur);
  const scale = totalKm !== undefined && total > 0 ? (totalKm * 1000) / total : 1;
  const main = passes.reduce((a, b) => (b.d < a.d ? b : a));
  return {
    distM: best,
    kms: passes.map((p) => (p.m * scale) / 1000),
    index: at[main.i] - cum[main.i] > (cum[main.i + 1] - cum[main.i]) / 2 ? main.i + 1 : main.i,
  };
}
