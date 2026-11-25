import { haversine } from './distance';
import type { Position, TrackGeometry } from './types';

/** Privacy margin (#1772): others do not see the first and last metres of a ridden track (home, garage). */
export const RIDE_PRIVACY_M = 300;

const lerp = (a: Position, b: Position, f: number): Position => a.map((v, i) => v + ((b[i] ?? v) - v) * f) as Position;

/**
 * Cuts the first and last `m` metres of a track (measured along it, across lines for a MultiLineString).
 * Returns `null` when nothing is left (track shorter than 2 × `m`). The cut points are interpolated.
 */
export function trimEnds(g: TrackGeometry, m = RIDE_PRIVACY_M): TrackGeometry | null {
  const lines: Position[][] = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  const total = lines.reduce((a, l) => a + l.slice(1).reduce((s, p, i) => s + haversine(l[i], p), 0), 0);
  if (!(total > 2 * m)) return null;
  const lo = m;
  const hi = total - m;
  const out: Position[][] = [];
  let at = 0;
  for (const l of lines) {
    const cur: Position[] = [];
    for (let i = 0; i < l.length; i++) {
      const d = i === 0 ? 0 : haversine(l[i - 1], l[i]);
      const start = at;
      const end = at + d;
      if (i === 0) {
        if (start >= lo && start <= hi) cur.push(l[0]);
      } else if (d > 0) {
        const a = Math.max(start, lo);
        const b = Math.min(end, hi);
        if (a < b) {
          if (cur.length === 0 || a > start) cur.push(lerp(l[i - 1], l[i], (a - start) / d));
          cur.push(b < end ? lerp(l[i - 1], l[i], (b - start) / d) : l[i]);
        }
      }
      at = end;
    }
    // drop consecutive duplicates introduced by the cut
    const dedup = cur.filter((p, i) => i === 0 || p[0] !== cur[i - 1][0] || p[1] !== cur[i - 1][1]);
    if (dedup.length >= 2) out.push(dedup);
  }
  if (out.length === 0) return null;
  return out.length === 1 ? { type: 'LineString', coordinates: out[0] } : { type: 'MultiLineString', coordinates: out };
}
