import type { Position, TrackGeometry } from './types';
import { haversine } from './distance';
import { smoothSymmetric } from './elevation';

/**
 * Tronçons de pente **orientés** (départ → arrivée = ordre des coordonnées) et bornes kilométriques.
 * Logique pure, réutilisée par la carte, le profil et l'éditeur (#1380). Inverser le sens d'une trace
 * inverse les classes : une montée devient une descente.
 */

/** Seuils de pente en %, valeurs absolues : classes 1..5 = [0–3[, [3–6[, [6–9[, [9–12[, 12+. Source unique. */
export const SLOPE_THRESHOLDS = [3, 6, 9, 12] as const;
/** Sous cette pente (en valeur absolue, %), le tronçon est « plat » : couleur neutre, pas de dégradé. */
export const FLAT_GRADE = 1;
/** Longueur minimale (m) sur laquelle une pente est mesurée : en dessous, le bruit GPS donne des pentes absurdes. */
export const SLOPE_WINDOW_M = 50;
/** Nombre maximal de bornes km affichées quand le pas est automatique. */
export const MAX_KM_MARKERS = 25;
/** Pas automatiques possibles (km), du plus fin au plus large. */
const KM_STEPS = [1, 2, 5, 10, 20, 50, 100];

export type SlopeDirection = 'up' | 'down' | 'flat';
export type SlopeClass = {
  direction: SlopeDirection;
  /** 1 (douce) à 5 (très raide) ; 0 pour « plat ». */
  level: 0 | 1 | 2 | 3 | 4 | 5;
  /** Nom du token couleur (`slope-up-3`), `null` pour « plat ». */
  token: string | null;
  /** Identifiant stable (`up-3`, `down-1`, `flat`) : sert à fusionner les tronçons voisins. */
  id: string;
};

/** Classe de pente d'une pente signée en % (+ montée, − descente). */
export function slopeClass(grade: number): SlopeClass {
  const abs = Math.abs(grade);
  if (!Number.isFinite(grade) || abs < FLAT_GRADE) return { direction: 'flat', level: 0, token: null, id: 'flat' };
  const direction: SlopeDirection = grade > 0 ? 'up' : 'down';
  const level = (SLOPE_THRESHOLDS.filter((t) => abs >= t).length + 1) as 1 | 2 | 3 | 4 | 5;
  return { direction, level, token: `slope-${direction}-${level}`, id: `${direction}-${level}` };
}

/** Couleur CSS (variable du thème) d'une classe ; neutre pour « plat » ou une trace sans altitude. */
export function slopeCssColor(cls: SlopeClass | null): string {
  return cls?.token ? `var(--${cls.token})` : 'var(--muted-foreground)';
}

/**
 * Pente (%) de chaque arête i → i+1 à partir de distances cumulées (m) et d'altitudes.
 * Altitudes lissées comme `gainLoss` (moyenne glissante de 5 points, mais symétrique aux bords pour ne pas
 * aplatir le début et la fin d'une montée), puis pente mesurée sur une fenêtre
 * centrée sur l'arête élargie jusqu'à couvrir au moins `windowM`.
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
  /** Sommets du tronçon (au moins 2), dans le sens de la trace. */
  coordinates: Position[];
  /** Pente moyenne signée (%) du tronçon. */
  grade: number;
  class: SlopeClass;
  /** Distance cumulée (km) depuis le départ de la trace. */
  fromKm: number;
  toKm: number;
};

const lines = (g: TrackGeometry): Position[][] => (g.type === 'LineString' ? [g.coordinates] : g.coordinates);
const hasEle = (p: Position) => typeof p[2] === 'number' && !Number.isNaN(p[2]);

/**
 * Découpe une trace en tronçons de même classe de pente. Tableau vide si une altitude manque
 * (la carte dessine alors la trace en couleur neutre). Les tronçons de même classe voisins sont fusionnés.
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

/** Pas (km) retenu pour une trace de `totalKm` : le plus fin de 1/2/5/10/… km qui reste sous `MAX_KM_MARKERS` bornes. */
export function autoKmStep(totalKm: number): number {
  return KM_STEPS.find((s) => Math.floor(totalKm / s) <= MAX_KM_MARKERS) ?? KM_STEPS[KM_STEPS.length - 1];
}

/**
 * Bornes kilométriques le long de la trace (position interpolée, numéro = km). `stepKm` explicite = exactement ce
 * pas ; omis = pas automatique (`autoKmStep`) pour ne pas noyer la carte sous les bornes. MultiLineString : la
 * distance se cumule d'une ligne à l'autre (les trous ne comptent pas). Fonctionne sans altitude.
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
 * Pas des bornes affichées selon le zoom de la carte (#1382) : toutes les bornes de près, une sur 5 à moyenne
 * distance, une sur 10 de loin, pour ne pas surcharger la carte.
 */
export function kmStepForZoom(zoom: number): number {
  if (zoom >= 13) return 1;
  if (zoom >= 11) return 5;
  return 10;
}
