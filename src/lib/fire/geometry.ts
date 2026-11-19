import { haversine, type TrackGeometry } from '@/lib/geo';
import type { MassifGeometry } from './types';

type Ring = number[][];

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point in a MultiPolygon (outer ring, holes excluded). */
export function pointInMassif(lon: number, lat: number, g: MassifGeometry): boolean {
  for (const poly of g.coordinates) {
    if (inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h))) return true;
  }
  return false;
}

export type MassifShape = {
  code: string;
  name: string;
  geometry: MassifGeometry;
  bbox: [number, number, number, number];
};

export function bboxOfMassif(g: MassifGeometry): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const poly of g.coordinates) for (const [x, y] of poly[0]) {
    if (x < a) a = x;
    if (x > c) c = x;
    if (y < b) b = y;
    if (y > d) d = y;
  }
  return [a, b, c, d];
}

const STEP_M = 50;

/** Points of the line, densified every ~50 m (a simplified track may step over a small massif). */
function* densePoints(coords: number[][]): Generator<[number, number]> {
  for (let i = 0; i < coords.length; i++) {
    const p = coords[i];
    yield [p[0], p[1]];
    const q = coords[i + 1];
    if (!q) continue;
    const n = Math.floor(haversine([p[0], p[1]], [q[0], q[1]]) / STEP_M);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      yield [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    }
  }
}

/** Codes of the massifs crossed by the track (at least one point inside the massif), sorted. */
export function massifsCrossed(geometry: TrackGeometry, massifs: MassifShape[]): string[] {
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  const found = new Set<string>();
  for (const line of lines) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const [x, y] of line) {
      if (x < a) a = x;
      if (x > c) c = x;
      if (y < b) b = y;
      if (y > d) d = y;
    }
    const candidates = massifs.filter((m) => !found.has(m.code) && m.bbox[0] <= c && m.bbox[2] >= a && m.bbox[1] <= d && m.bbox[3] >= b);
    if (!candidates.length) continue;
    for (const [x, y] of densePoints(line)) {
      for (const m of candidates) {
        if (!found.has(m.code) && x >= m.bbox[0] && x <= m.bbox[2] && y >= m.bbox[1] && y <= m.bbox[3] && pointInMassif(x, y, m.geometry)) found.add(m.code);
      }
      if (candidates.every((m) => found.has(m.code))) break;
    }
  }
  return [...found].sort();
}
