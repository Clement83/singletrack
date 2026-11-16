import type { Position, TrackGeometry } from './types';

const M_PER_DEG = 111_320;

/** Distance (m) d'un point à un segment, en projection équirectangulaire locale (suffisant à l'échelle d'une trace). */
function segDistance(p: Position, a: Position, b: Position): number {
  const k = Math.cos((p[1] * Math.PI) / 180);
  const px = (p[0] - a[0]) * k * M_PER_DEG;
  const py = (p[1] - a[1]) * M_PER_DEG;
  const bx = (b[0] - a[0]) * k * M_PER_DEG;
  const by = (b[1] - a[1]) * M_PER_DEG;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Douglas-Peucker itératif (pas de récursion : les traces ont des milliers de points). Tolérance en mètres. */
export function simplifyLine(coords: Position[], toleranceM: number): Position[] {
  if (coords.length <= 2) return coords.slice();
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDistance(coords[i], coords[s], coords[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

export function simplifyGeometry(g: TrackGeometry, toleranceM: number): TrackGeometry {
  return g.type === 'LineString'
    ? { type: 'LineString', coordinates: simplifyLine(g.coordinates, toleranceM) }
    : { type: 'MultiLineString', coordinates: g.coordinates.map((l) => simplifyLine(l, toleranceM)) };
}
