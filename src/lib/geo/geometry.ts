import type { Bbox, Position, TrackGeometry } from './types';
import { haversine, lineLength } from './distance';
import { elevationStats, type ElevationStats } from './elevation';

/** The lines of a geometry (a single one for a LineString). */
export function lines(g: TrackGeometry): Position[][] {
  return g.type === 'LineString' ? [g.coordinates] : g.coordinates;
}

export function geometryLength(g: TrackGeometry): number {
  return lines(g).reduce((s, l) => s + lineLength(l), 0);
}

/** Extent (bbox) of a geometry; `null` if it is empty. */
export function bboxOf(g: TrackGeometry): Bbox | null {
  let b: Bbox | null = null;
  for (const l of lines(g)) {
    for (const [lon, lat] of l) {
      if (!b) b = { minLon: lon, minLat: lat, maxLon: lon, maxLat: lat };
      else {
        if (lon < b.minLon) b.minLon = lon;
        if (lon > b.maxLon) b.maxLon = lon;
        if (lat < b.minLat) b.minLat = lat;
        if (lat > b.maxLat) b.maxLat = lat;
      }
    }
  }
  return b;
}

/** Start point `[lon, lat]`, or `null`. */
export function startOf(g: TrackGeometry): [number, number] | null {
  const first = lines(g).find((l) => l.length > 0)?.[0];
  return first ? [first[0], first[1]] : null;
}

/** Loop: start and finish within `toleranceM` metres (200 m by default). */
export function isLoop(g: TrackGeometry, toleranceM = 200): boolean {
  const all = lines(g).filter((l) => l.length > 1);
  if (all.length === 0) return false;
  const first = all[0][0];
  const lastLine = all[all.length - 1];
  const last = lastLine[lastLine.length - 1];
  return haversine(first, last) <= toleranceM;
}

export type GeometryStats = ElevationStats & { distanceM: number; bbox: Bbox | null; start: [number, number] | null; loop: boolean };

/** Every statistic derived from the geometry, to fill a track. */
export function geometryStats(g: TrackGeometry): GeometryStats {
  return {
    distanceM: geometryLength(g),
    bbox: bboxOf(g),
    start: startOf(g),
    loop: isLoop(g),
    ...elevationStats(lines(g)),
  };
}
