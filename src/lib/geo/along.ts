import { haversine } from './distance';
import type { Position, TrackGeometry } from './types';

export type AlongResult = {
  /** Distance (m) entre le point demandé et la trace, au passage le plus proche. */
  distM: number;
  /** Km depuis le départ à chaque passage proche du point (croissants) : un seul, deux pour une boucle ou un aller-retour. */
  kms: number[];
  /** Indice du sommet de la trace le plus proche du passage principal (pour retrouver altitude / pente). */
  index: number;
};

/** Marge (m) autour du passage le plus proche : au-delà, un autre passage n'est plus « au même endroit ». */
const PASS_TOLERANCE_M = 25;

const flatten = (g: TrackGeometry | Position[]): Position[] =>
  Array.isArray(g) ? g : g.type === 'LineString' ? g.coordinates : g.coordinates.flat();

/**
 * Km depuis le départ au point de la trace le plus proche de `[lon, lat]` (#1535). Projette le point sur chaque
 * arête (plan local équirectangulaire), puis regroupe les arêtes proches contiguës en « passages » : un aller-retour
 * ou une boucle qui repasse au même endroit renvoie ainsi deux km (« km 3,2 · km 28,4 »).
 * `totalKm` recale l'échelle quand la géométrie est simplifiée (longueur réelle connue par ailleurs).
 * Renvoie `null` pour une trace de moins de 2 points.
 */
export function kmAlongTrack(geometry: TrackGeometry | Position[], lon: number, lat: number, totalKm?: number): AlongResult | null {
  const pts = flatten(geometry);
  if (pts.length < 2) return null;
  const k = Math.cos((lat * Math.PI) / 180);
  const M = 111_320;
  // Pour chaque arête : distance au point (m) et abscisse curviligne (m) de la projection.
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const dist: number[] = [];
  const at: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = (pts[i][0] - lon) * k * M, ay = (pts[i][1] - lat) * M;
    const bx = (pts[i + 1][0] - lon) * k * M, by = (pts[i + 1][1] - lat) * M;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    dist.push(Math.hypot(ax + t * dx, ay + t * dy));
    at.push(cum[i] + t * (cum[i + 1] - cum[i]));
  }
  const best = Math.min(...dist);
  const limit = best + PASS_TOLERANCE_M;
  const passes: { d: number; m: number; i: number }[] = [];
  let cur: { d: number; m: number; i: number } | null = null;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] <= limit) {
      if (!cur) cur = { d: dist[i], m: at[i], i };
      else if (dist[i] < cur.d) cur = { d: dist[i], m: at[i], i };
    } else if (cur) {
      passes.push(cur);
      cur = null;
    }
  }
  if (cur) passes.push(cur);
  const scale = totalKm !== undefined && total > 0 ? (totalKm * 1000) / total : 1;
  const main = passes.reduce((a, b) => (b.d < a.d ? b : a));
  return {
    distM: best,
    kms: passes.map((p) => (p.m * scale) / 1000),
    index: at[main.i] - cum[main.i] > (cum[main.i + 1] - cum[main.i]) / 2 ? main.i + 1 : main.i,
  };
}
