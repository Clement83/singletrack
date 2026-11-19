import type { Position, TrackGeometry } from './types';
import { slopeSegments } from './slopes';

/**
 * Data of the "track coloured by slope" layer (#1381): pure logic, tested.
 * Each segment carries `cls` = `up-3`, `down-1`, `flat` or `none` (unknown elevation → neutral colour).
 */
export type SlopeFeature = {
  type: 'Feature';
  properties: { cls: string; grade: number };
  geometry: { type: 'LineString'; coordinates: Position[] };
};
export type SlopeCollection = { type: 'FeatureCollection'; features: SlopeFeature[] };

const feature = (coordinates: Position[], cls: string, grade = 0): SlopeFeature => ({
  type: 'Feature',
  properties: { cls, grade },
  geometry: { type: 'LineString', coordinates },
});

const lines = (g: TrackGeometry): Position[][] => (g.type === 'LineString' ? [g.coordinates] : g.coordinates);
const hasEle = (p: Position) => typeof p[2] === 'number' && !Number.isNaN(p[2]);

/** Coloured segments of a geometry; without elevation, a single neutral line (`none`) per line. */
export function slopeFeatures(geometry: TrackGeometry): SlopeCollection {
  const segs = slopeSegments(geometry);
  if (segs.length) return { type: 'FeatureCollection', features: segs.map((s) => feature(s.coordinates, s.class.id, s.grade)) };
  return { type: 'FeatureCollection', features: lines(geometry).filter((l) => l.length >= 2).map((l) => feature(l, 'none')) };
}

/**
 * Editor: consecutive "paths" segments that all have their elevation form one continuous route (slope
 * computed over the whole); the others stay neutral. Straight lines are not passed here.
 */
export function slopeFeaturesForRuns(segmentLines: { coords: Position[]; route: boolean }[]): SlopeCollection {
  const features: SlopeFeature[] = [];
  let run: Position[] = [];
  const flush = () => {
    if (run.length >= 2) features.push(...slopeFeatures({ type: 'LineString', coordinates: run }).features);
    run = [];
  };
  for (const s of segmentLines) {
    if (!s.route) {
      flush();
      continue;
    }
    if (s.coords.every(hasEle)) {
      run = run.length ? [...run, ...s.coords.slice(1)] : [...s.coords];
    } else {
      flush();
      if (s.coords.length >= 2) features.push(feature(s.coords, 'none'));
    }
  }
  flush();
  return { type: 'FeatureCollection', features };
}

export const SLOPE_CLASS_IDS = ['up-1', 'up-2', 'up-3', 'up-4', 'up-5', 'down-1', 'down-2', 'down-3', 'down-4', 'down-5'] as const;

/** Colour of a class (`up-3`…); `flat` and `none`: neutral colours provided. */
export function slopeColorOf(cls: string, colors: Record<string, string>, flat: string, none: string): string {
  if (cls === 'flat') return flat;
  if (cls === 'none') return none;
  return colors[`slope-${cls}`] ?? none;
}

/** MapLibre `match` expression on the `cls` property. */
export function slopeMatchExpression(colors: Record<string, string>, flat: string, none: string): unknown[] {
  const expr: unknown[] = ['match', ['get', 'cls']];
  for (const id of SLOPE_CLASS_IDS) expr.push(id, slopeColorOf(id, colors, flat, none));
  expr.push('flat', flat);
  expr.push(none);
  return expr;
}
