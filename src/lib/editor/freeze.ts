import type { Position } from '@/lib/geo';
import { distToSeg, toXY } from './choice';
import type { EditorDoc, LonLat } from './doc';

/**
 * Freezing a validated path (#1812): when the user keeps an alternative / a "new path", the minimum number of normal
 * waypoints is inserted so that BRouter gives back exactly this line between consecutive waypoints. Pure logic: routing is
 * provided by the caller (`RouteFn`).
 */
/** Tolerance (m) under which a BRouter line "is" the validated one (two computations on the same paths differ by a few metres). */
export const FREEZE_TOL_M = 8;
/** Cap of waypoints added by one freeze (BRouter is not deterministic between close points: never loop). */
export const FREEZE_MAX_POINTS = 24;

export type RouteFn = (from: LonLat, to: LonLat) => Promise<Position[] | null>;

/** Largest distance (m) of a vertex of `a` to the polyline `b`, and the index of that vertex. */
export function maxDeviation(a: Position[], b: Position[]): { d: number; at: number } {
  if (!a.length || !b.length) return { d: 0, at: 0 };
  const lat0 = b[0][1];
  const bxy = b.map((c) => toXY(c, lat0));
  let d = 0;
  let at = 0;
  a.forEach((c, k) => {
    const q = toXY(c, lat0);
    let m = Infinity;
    if (bxy.length === 1) m = Math.hypot(q[0] - bxy[0][0], q[1] - bxy[0][1]);
    for (let j = 1; j < bxy.length && m > d; j++) m = Math.min(m, distToSeg(q, bxy[j - 1], bxy[j]));
    if (m > d) {
      d = m;
      at = k;
    }
  });
  return { d, at };
}

const ll = (c: Position): LonLat => [c[0], c[1]];

/**
 * Interior vertices of `target` (indices, sorted) to use as waypoints so that routing between consecutive ones follows
 * `target`. Divide and conquer on the largest gap (like Douglas-Peucker): the result is minimal-ish, never a point every 50 m.
 */
export async function freezeCuts(target: Position[], route: RouteFn, tolM = FREEZE_TOL_M, maxPoints = FREEZE_MAX_POINTS): Promise<number[]> {
  const cuts: number[] = [];
  const fit = async (i: number, j: number): Promise<void> => {
    if (j - i < 2 || cuts.length >= maxPoints) return;
    const slice = target.slice(i, j + 1);
    const r = await route(ll(target[i]), ll(target[j]));
    let k: number | null = null;
    if (!r) k = Math.floor((i + j) / 2);
    else {
      const a = maxDeviation(slice, r);
      const b = maxDeviation(r, slice);
      if (a.d > tolM || b.d > tolM) {
        if (a.d >= b.d) k = i + a.at;
        else {
          // The routed line leaves the target: cut at the target vertex closest to the point where it strays most.
          const p = r[b.at];
          let best = Infinity;
          slice.forEach((c, n) => {
            const dd = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2;
            if (dd < best) {
              best = dd;
              k = i + n;
            }
          });
        }
      }
    }
    if (k === null) return;
    k = Math.min(j - 1, Math.max(i + 1, k));
    cuts.push(k);
    await fit(i, k);
    await fit(k, j);
  };
  await fit(0, target.length - 1);
  return cuts.sort((x, y) => x - y);
}

/**
 * Replaces the segment whose computed line **is** `target` (same array) by one segment per cut, each keeping its slice of the line:
 * nothing is recomputed. The document is returned unchanged if the segment is gone or its ends moved.
 */
export function freezeSegment(doc: EditorDoc, target: Position[], cuts: number[]): EditorDoc {
  const k = doc.segments.findIndex((s) => s.mode === 'route' && s.coords === target);
  const cs = [...new Set(cuts)].filter((c) => c > 0 && c < target.length - 1).sort((x, y) => x - y);
  if (k < 0 || !cs.length) return doc;
  const a = doc.waypoints[k];
  const b = doc.waypoints[k + 1];
  if (!a || !b || a[0] !== target[0][0] || a[1] !== target[0][1] || b[0] !== target.at(-1)![0] || b[1] !== target.at(-1)![1]) return doc;
  const bounds = [0, ...cs, target.length - 1];
  const waypoints = [...doc.waypoints];
  waypoints.splice(k + 1, 0, ...cs.map((c) => ll(target[c])));
  const segments = [...doc.segments];
  segments.splice(k, 1, ...bounds.slice(1).map((end, n) => ({ mode: 'route' as const, coords: target.slice(bounds[n], end + 1) })));
  return { waypoints, segments };
}
