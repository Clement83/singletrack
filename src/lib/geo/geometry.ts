import type { Bbox, Position, TrackGeometry } from './types';
import { haversine, lineLength } from './distance';
import { elevationStats, type ElevationStats } from './elevation';

/** Les lignes d'une géométrie (une seule pour un LineString). */
export function lines(g: TrackGeometry): Position[][] {
  return g.type === 'LineString' ? [g.coordinates] : g.coordinates;
}

export function geometryLength(g: TrackGeometry): number {
  return lines(g).reduce((s, l) => s + lineLength(l), 0);
}

/** Emprise (bbox) d'une géométrie ; `null` si elle est vide. */
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

/** Point de départ `[lon, lat]`, ou `null`. */
export function startOf(g: TrackGeometry): [number, number] | null {
  const first = lines(g).find((l) => l.length > 0)?.[0];
  return first ? [first[0], first[1]] : null;
}

/** Boucle : départ et arrivée à moins de `toleranceM` mètres (200 m par défaut). */
export function isLoop(g: TrackGeometry, toleranceM = 200): boolean {
  const all = lines(g).filter((l) => l.length > 1);
  if (all.length === 0) return false;
  const first = all[0][0];
  const lastLine = all[all.length - 1];
  const last = lastLine[lastLine.length - 1];
  return haversine(first, last) <= toleranceM;
}

export type GeometryStats = ElevationStats & { distanceM: number; bbox: Bbox | null; start: [number, number] | null; loop: boolean };

/** Toutes les statistiques dérivées de la géométrie, pour remplir une trace. */
export function geometryStats(g: TrackGeometry): GeometryStats {
  return {
    distanceM: geometryLength(g),
    bbox: bboxOf(g),
    start: startOf(g),
    loop: isLoop(g),
    ...elevationStats(lines(g)),
  };
}
