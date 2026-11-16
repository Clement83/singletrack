import type { Position, TrackGeometry } from './types';
import { slopeSegments } from './slopes';

/**
 * Données de la couche « trace colorée par pente » (#1381) : logique pure, testée.
 * Chaque tronçon porte `cls` = `up-3`, `down-1`, `flat` ou `none` (altitude inconnue → couleur neutre).
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

/** Tronçons colorés d'une géométrie ; sans altitude, une seule ligne neutre (`none`) par ligne. */
export function slopeFeatures(geometry: TrackGeometry): SlopeCollection {
  const segs = slopeSegments(geometry);
  if (segs.length) return { type: 'FeatureCollection', features: segs.map((s) => feature(s.coordinates, s.class.id, s.grade)) };
  return { type: 'FeatureCollection', features: lines(geometry).filter((l) => l.length >= 2).map((l) => feature(l, 'none')) };
}

/**
 * Éditeur : les segments « chemins » consécutifs qui ont tous leur altitude forment un parcours continu (pente
 * calculée sur l'ensemble) ; les autres restent neutres. Les lignes droites ne sont pas passées ici.
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

/** Couleur d'une classe (`up-3`…) ; `flat` et `none` : couleurs neutres fournies. */
export function slopeColorOf(cls: string, colors: Record<string, string>, flat: string, none: string): string {
  if (cls === 'flat') return flat;
  if (cls === 'none') return none;
  return colors[`slope-${cls}`] ?? none;
}

/** Expression MapLibre `match` sur la propriété `cls`. */
export function slopeMatchExpression(colors: Record<string, string>, flat: string, none: string): unknown[] {
  const expr: unknown[] = ['match', ['get', 'cls']];
  for (const id of SLOPE_CLASS_IDS) expr.push(id, slopeColorOf(id, colors, flat, none));
  expr.push('flat', flat);
  expr.push(none);
  return expr;
}
