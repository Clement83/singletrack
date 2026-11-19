import type { Position, TrackGeometry } from './types';
import { haversine } from './distance';
import { smoothSymmetric } from './elevation';

/**
 * **Oriented** slope segments (start → finish = order of the coordinates) and kilometre markers.
 * Pure logic, reused by the map, the profile and the editor (#1380). Reversing the direction of a track
 * reverses the classes: a climb becomes a descent.
 */

/** Slope thresholds in %, absolute values: classes 1..5 = [0–3[, [3–6[, [6–9[, [9–12[, 12+. Single source. */
export const SLOPE_THRESHOLDS = [3, 6, 9, 12] as const;
/** Below this slope (absolute value, %), the segment is "flat": neutral colour, no gradient. */
export const FLAT_GRADE = 1;
/** Minimum length (m) over which a slope is measured: below it, GPS noise gives absurd slopes. */
export const SLOPE_WINDOW_M = 50;
/** Maximum number of km markers shown when the step is automatic. */
export const MAX_KM_MARKERS = 25;
/** Possible automatic steps (km), finest to widest. */
const KM_STEPS = [1, 2, 5, 10, 20, 50, 100];

export type SlopeDirection = 'up' | 'down' | 'flat';
export type SlopeClass = {
  direction: SlopeDirection;
  /** 1 (gentle) to 5 (very steep); 0 for "flat". */
  level: 0 | 1 | 2 | 3 | 4 | 5;
  /** Name of the colour token (`slope-up-3`), `null` for "flat". */
  token: string | null;
  /** Stable id (`up-3`, `down-1`, `flat`): used to merge neighbouring segments. */
  id: string;
};

/** Slope class of a signed slope in % (+ climb, − descent). */
export function slopeClass(grade: number): SlopeClass {
  const abs = Math.abs(grade);
  if (!Number.isFinite(grade) || abs < FLAT_GRADE) return { direction: 'flat', level: 0, token: null, id: 'flat' };
  const direction: SlopeDirection = grade > 0 ? 'up' : 'down';
  const level = (SLOPE_THRESHOLDS.filter((t) => abs >= t).length + 1) as 1 | 2 | 3 | 4 | 5;
  return { direction, level, token: `slope-${direction}-${level}`, id: `${direction}-${level}` };
}

/** CSS colour (theme variable) of a class; neutral for "flat" or a track without elevation. */
export function slopeCssColor(cls: SlopeClass | null): string {
  return cls?.token ? `var(--${cls.token})` : 'var(--muted-foreground)';
}

/**
 * Slope (%) of each edge i → i+1 from cumulative distances (m) and elevations.
 * Elevations smoothed like `gainLoss` (5-point moving average, but symmetric at the edges so as not to
 * flatten the start and end of a climb), then slope measured over a window
 * centred on the edge and widened until it covers at least `windowM`.
 */
export function edgeGrades(distM: number[], eles: number[], windowM = SLOPE_WINDOW_M): number[] {
  const n = eles.length;
  if (n < 2) return [];
  const s = smoothSymmetric(eles, 5);
  const grades: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    let lo = i;
    let hi = i + 1;
    while (distM[hi] - distM[lo] < windowM && (lo > 0 || hi < n - 1)) {
      if (lo > 0) lo--;
      if (distM[hi] - distM[lo] >= windowM) break;
      if (hi < n - 1) hi++;
    }
    const d = distM[hi] - distM[lo];
    grades.push(d > 0 ? ((s[hi] - s[lo]) / d) * 100 : 0);
  }
  return grades;
}

export type SlopeSegment = {
  /** Vertices of the segment (at least 2), in the direction of the track. */
  coordinates: Position[];
  /** Signed average slope (%) of the segment. */
  grade: number;
  class: SlopeClass;
  /** Cumulative distance (km) from the start of the track. */
  fromKm: number;
  toKm: number;
};

const lines = (g: TrackGeometry): Position[][] => (g.type === 'LineString' ? [g.coordinates] : g.coordinates);
const hasEle = (p: Position) => typeof p[2] === 'number' && !Number.isNaN(p[2]);

/**
 * Cuts a track into segments of the same slope class. Empty array if an elevation is missing
 * (the map then draws the track in a neutral colour). Neighbouring segments of the same class are merged.
 */
export function slopeSegments(geometry: TrackGeometry): SlopeSegment[] {
  const all = lines(geometry);
  if (all.flat().length < 2 || !all.flat().every(hasEle)) return [];
  const out: SlopeSegment[] = [];
  let offsetM = 0;
  for (const line of all) {
    if (line.length < 2) continue;
    const distM = [0];
    for (let i = 1; i < line.length; i++) distM.push(distM[i - 1] + haversine(line[i - 1], line[i]));
    const grades = edgeGrades(distM, line.map((p) => p[2] as number));
    let cur: { cls: SlopeClass; start: number; end: number } | null = null;
    const flush = () => {
      if (!cur) return;
      const coordinates = line.slice(cur.start, cur.end + 1);
      const d = distM[cur.end] - distM[cur.start];
      const grade = d > 0 ? (((line[cur.end][2] as number) - (line[cur.start][2] as number)) / d) * 100 : 0;
      out.push({ coordinates, grade, class: cur.cls, fromKm: (offsetM + distM[cur.start]) / 1000, toKm: (offsetM + distM[cur.end]) / 1000 });
    };
    grades.forEach((g, i) => {
      const cls = slopeClass(g);
      if (cur && cur.cls.id === cls.id) cur.end = i + 1;
      else {
        flush();
        cur = { cls, start: i, end: i + 1 };
      }
    });
    flush();
    offsetM += distM[distM.length - 1];
  }
  return out;
}

export type KmMarker = { km: number; position: [number, number] };

/** Step (km) chosen for a track of `totalKm`: the finest of 1/2/5/10/… km that stays under `MAX_KM_MARKERS` markers. */
export function autoKmStep(totalKm: number): number {
  return KM_STEPS.find((s) => Math.floor(totalKm / s) <= MAX_KM_MARKERS) ?? KM_STEPS[KM_STEPS.length - 1];
}

/**
 * Kilometre markers along the track (interpolated position, number = km). Explicit `stepKm` = exactly that
 * step; omitted = automatic step (`autoKmStep`) so the map is not swamped with markers. MultiLineString: the
 * distance accumulates from one line to the next (gaps do not count). Works without elevation.
 */
export function kmMarkers(geometry: TrackGeometry, stepKm?: number): KmMarker[] {
  const segs: { a: Position; b: Position; from: number; len: number }[] = [];
  let total = 0;
  for (const line of lines(geometry))
    for (let i = 1; i < line.length; i++) {
      const len = haversine(line[i - 1], line[i]);
      segs.push({ a: line[i - 1], b: line[i], from: total, len });
      total += len;
    }
  const step = stepKm ?? autoKmStep(total / 1000);
  if (!(step > 0)) return [];
  const markers: KmMarker[] = [];
  let k = 0;
  for (let km = step; km * 1000 <= total + 1e-6; km += step) {
    const target = km * 1000;
    while (k < segs.length - 1 && segs[k].from + segs[k].len < target) k++;
    const s = segs[k];
    const t = s.len > 0 ? Math.min(1, Math.max(0, (target - s.from) / s.len)) : 0;
    markers.push({ km: Math.round(km * 1e6) / 1e6, position: [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t] });
  }
  return markers;
}

/**
 * Step of the markers shown according to the map zoom (#1382): every marker up close, one in 5 at medium
 * distance, one in 10 from afar, so as not to clutter the map.
 */
export function kmStepForZoom(zoom: number): number {
  if (zoom >= 13) return 1;
  if (zoom >= 11) return 5;
  return 10;
}
