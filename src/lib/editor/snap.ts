import type { Position } from '@/lib/geo';
import type { LonLat } from './doc';

/**
 * Editor magnet (#1437): a point placed near a singletrack or the current track attaches to it.
 * Pure logic: the screen projection is injected (`project`/`unproject` from MapLibre), so the tolerance is
 * in **screen pixels** (a finger is imprecise, whatever the zoom).
 */

/** Finger and mouse tolerance (screen px), maintainer's decision (#1437). */
export const SNAP_TOLERANCE_TOUCH_PX = 24;
export const SNAP_TOLERANCE_MOUSE_PX = 10;

export type Px = { x: number; y: number };
export type SnapLine = { coordinates: Position[] };
/** Groups by decreasing priority (singletracks, then current track): the first group within reach wins. */
export type SnapGroup = { id: string; lines: SnapLine[] };
export type SnapHit = { point: LonLat; distPx: number; group: string };

/** Projects screen point `p` onto segment [a, b]: parametric coordinate t ∈ [0, 1] and distance. */
export function projectOnSegment(p: Px, a: Px, b: Px): { t: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { t, dist: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) };
}

/**
 * Closest point to `at` (screen position) on the lines of `groups`, within `tolPx`. It projects onto the
 * closest **segment**, not onto the vertex: otherwise a long straight line attracts anywhere (#1437).
 * The returned point is interpolated between the two vertices of the segment (in lon/lat, exact at this scale).
 */
export function snapToGroups(
  at: Px, groups: SnapGroup[], project: (p: Position) => Px, tolPx: number,
  /** Lon/lat extent of the tolerance area: avoids projecting thousands of out-of-reach vertices (smooth drag). */
  box?: [number, number, number, number],
): SnapHit | null {
  const out = (a: Position, b: Position) =>
    !!box && ((a[0] < box[0] && b[0] < box[0]) || (a[0] > box[2] && b[0] > box[2]) || (a[1] < box[1] && b[1] < box[1]) || (a[1] > box[3] && b[1] > box[3]));
  for (const g of groups) {
    let best: SnapHit | null = null;
    for (const line of g.lines) {
      const c = line.coordinates;
      if (c.length < 2) continue;
      let prev: Px | null = null;
      for (let i = 1; i < c.length; i++) {
        if (out(c[i - 1], c[i])) {
          prev = null;
          continue;
        }
        prev ??= project(c[i - 1]);
        const cur = project(c[i]);
        // Quick rejection: the segment is far from the tolerance box.
        if (
          !(Math.max(prev.x, cur.x) < at.x - tolPx || Math.min(prev.x, cur.x) > at.x + tolPx ||
            Math.max(prev.y, cur.y) < at.y - tolPx || Math.min(prev.y, cur.y) > at.y + tolPx)
        ) {
          const { t, dist } = projectOnSegment(at, prev, cur);
          if (dist <= tolPx && (!best || dist < best.distPx)) {
            best = { point: [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t], distPx: dist, group: g.id };
          }
        }
        prev = cur;
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * BRouter magnet: once the segment is computed, waypoint `from`/`to` is brought back onto the start/end of the line
 * if the gap is under the tolerance (the router attached to the nearest path). Returns `null` if there is nothing to do
 * (already on it within ~1 px, or too far: off-trail point left free).
 */
export function snapEndpoint(waypoint: LonLat, routeEnd: Position, project: (p: Position) => Px, tolPx: number): LonLat | null {
  const a = project(waypoint);
  const b = project(routeEnd);
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return d > 0.5 && d <= tolPx ? [routeEnd[0], routeEnd[1]] : null;
}

/** Width (px) of the click areas of the track and the alternatives (#1524): narrow with a mouse so that a click on a nearby road adds a point instead of inserting one on the track. */
export const HIT_WIDTH_TOUCH_PX = 28;
export const HIT_WIDTH_MOUSE_PX = 8;
export const hitWidth = (finePointer: boolean) => (finePointer ? HIT_WIDTH_MOUSE_PX : HIT_WIDTH_TOUCH_PX);

export const snapTolerance = (finePointer: boolean) => (finePointer ? SNAP_TOLERANCE_MOUSE_PX : SNAP_TOLERANCE_TOUCH_PX);
