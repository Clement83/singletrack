import type { Position } from './types';

/** A line is dropped when more than this share of its points lies within `DEDUPE_DIST_M` of an already kept line. */
export const DEDUPE_SHARE = 0.9;
export const DEDUPE_DIST_M = 30;
const MAX_SAMPLES = 300;

const M_PER_DEG = 111_320;

/** Distance in metres from `p` to the segment `a`-`b` (local equirectangular projection, fine at this scale). */
function distToSegment(p: Position, a: Position, b: Position): number {
  const k = Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * k, ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * k, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy) * M_PER_DEG;
}

/** Share of `line`'s points (sampled) lying within `DEDUPE_DIST_M` of `other`. */
function coveredShare(line: Position[], other: Position[]): number {
  if (other.length < 2 || line.length === 0) return 0;
  const lo = [Math.min(...other.map((p) => p[0])), Math.min(...other.map((p) => p[1]))];
  const hi = [Math.max(...other.map((p) => p[0])), Math.max(...other.map((p) => p[1]))];
  const margin = (DEDUPE_DIST_M * 2) / M_PER_DEG;
  const step = Math.max(1, Math.floor(line.length / MAX_SAMPLES));
  let n = 0, hit = 0;
  for (let i = 0; i < line.length; i += step) {
    const p = line[i];
    n++;
    if (p[0] < lo[0] - margin || p[0] > hi[0] + margin || p[1] < lo[1] - margin || p[1] > hi[1] + margin) continue;
    for (let j = 1; j < other.length; j++) {
      if (distToSegment(p, other[j - 1], other[j]) <= DEDUPE_DIST_M) {
        hit++;
        break;
      }
    }
  }
  return hit / n;
}

/**
 * Indexes of the lines to keep (#1699). Exports often carry the same ride twice (a timed `gx:Track` plus a `LineString`,
 * two identical `<trk>`): a line that mostly (> 90 %) follows an already kept *other* line is dropped. Preference order:
 * timed lines first (`timed[i]`), then the most points, then file order. Distinct lines (GPS pause, consecutive pieces) are
 * kept. Never looks inside a single line, so a loop ridden twice stays. Returned indexes are in file order.
 */
export function dedupeLineIndexes(lines: Position[][], timed: boolean[] = []): number[] {
  const order = lines.map((_, i) => i).sort((a, b) => Number(!!timed[b]) - Number(!!timed[a]) || lines[b].length - lines[a].length || a - b);
  const kept: number[] = [];
  for (const i of order) {
    if (!kept.some((k) => coveredShare(lines[i], lines[k]) > DEDUPE_SHARE)) kept.push(i);
  }
  return kept.sort((a, b) => a - b);
}

