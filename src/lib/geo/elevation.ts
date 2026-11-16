import type { Position } from './types';
import { haversine } from './distance';

export type ElevationStats = {
  gainM: number | null;
  lossM: number | null;
  minEle: number | null;
  maxEle: number | null;
};

export type ElevationOptions = {
  /** Fenêtre de la moyenne glissante (nombre de points, impair). Défaut 1 (aucun lissage : altitudes IGN sans bruit, #1517). */
  window?: number;
  /** Seuil d'hystérésis en mètres : une variation plus petite est du bruit. Défaut 1 m (#1517). */
  thresholdM?: number;
};

/** Moyenne glissante centrée (fenêtre réduite aux bords). */
export function smooth(values: number[], window = 5): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(values.length - 1, i + half);
    let sum = 0;
    for (let k = from; k <= to; k++) sum += values[k];
    return sum / (to - from + 1);
  });
}

/**
 * Moyenne glissante centrée **symétrique** : aux bords, la fenêtre se réduit des deux côtés à la fois
 * (point 0 inchangé, point 1 = moyenne de 0..2…). Contrairement à `smooth`, une pente régulière reste
 * exactement linéaire jusqu'aux extrémités : sert au calcul des pentes (#1388).
 */
export function smoothSymmetric(values: number[], window = 5): number[] {
  const half = Math.floor(window / 2);
  const n = values.length;
  return values.map((_, i) => {
    const h = Math.min(half, i, n - 1 - i);
    let sum = 0;
    for (let k = i - h; k <= i + h; k++) sum += values[k];
    return sum / (2 * h + 1);
  });
}

/**
 * D+ / D- d'une série d'altitudes. Les altitudes enregistrées viennent de l'IGN (modèle de terrain, sans
 * bruit GPS, #1514) : pas de lissage par défaut (fenêtre 1) et seuil d'hystérésis de 1 m, qui n'écarte que
 * les arrondis. Un lissage de 5 points + seuil 3 m effaçait les petites bosses (946 m au lieu de 1077 m).
 * Pour des altitudes GPS brutes, passer `{ window: 5, thresholdM: 3 }`.
 */
export function gainLoss(eles: number[], opts: ElevationOptions = {}): { gainM: number; lossM: number } {
  if (eles.length < 2) return { gainM: 0, lossM: 0 };
  const s = smooth(eles, opts.window ?? 1);
  const threshold = opts.thresholdM ?? 1;
  let gain = 0;
  let loss = 0;
  let ref = s[0];
  for (let i = 1; i < s.length; i++) {
    const d = s[i] - ref;
    if (d >= threshold) {
      gain += d;
      ref = s[i];
    } else if (d <= -threshold) {
      loss += -d;
      ref = s[i];
    }
  }
  return { gainM: gain, lossM: loss };
}

/** Statistiques d'altitude sur des lignes. Tout `null` si une altitude manque. */
export function elevationStats(lineList: Position[][], opts: ElevationOptions = {}): ElevationStats {
  const all = lineList.flat();
  if (all.length === 0 || all.some((p) => typeof p[2] !== 'number' || Number.isNaN(p[2]))) {
    return { gainM: null, lossM: null, minEle: null, maxEle: null };
  }
  let gainM = 0;
  let lossM = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const l of lineList) {
    const eles = l.map((p) => p[2] as number);
    const r = gainLoss(eles, opts);
    gainM += r.gainM;
    lossM += r.lossM;
    for (const e of eles) {
      if (e < minEle) minEle = e;
      if (e > maxEle) maxEle = e;
    }
  }
  return { gainM, lossM, minEle, maxEle };
}

/** Profil altimétrique `{distKm, ele}` d'une ligne (pour `ElevationProfile`). */
export function profileOf(coords: Position[]): { distKm: number; ele: number }[] {
  const out: { distKm: number; ele: number }[] = [];
  let d = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) d += haversine(coords[i - 1], coords[i]);
    const ele = coords[i][2];
    if (typeof ele === 'number') out.push({ distKm: d / 1000, ele });
  }
  return out;
}

/**
 * Complète les altitudes manquantes (#1467) : interpolation linéaire selon la distance entre les points connus voisins,
 * valeur constante au-delà du premier/dernier point connu. `estimated[i]` vaut vrai pour les points complétés.
 * `null` si aucun point n'a d'altitude (rien à estimer).
 */
export function fillElevation(coords: Position[]): { eles: number[]; estimated: boolean[] } | null {
  const n = coords.length;
  const known: number[] = [];
  const dist: number[] = [0];
  for (let i = 0; i < n; i++) {
    if (i > 0) dist.push(dist[i - 1] + haversine(coords[i - 1], coords[i]));
    if (typeof coords[i][2] === 'number') known.push(i);
  }
  if (known.length === 0) return null;
  const eles: number[] = new Array(n);
  const estimated: boolean[] = new Array(n).fill(false);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (typeof coords[i][2] === 'number') {
      eles[i] = coords[i][2] as number;
      continue;
    }
    estimated[i] = true;
    while (k < known.length && known[k] < i) k++;
    const next = k < known.length ? known[k] : -1;
    const prev = k > 0 ? known[k - 1] : -1;
    if (prev < 0) eles[i] = coords[next][2] as number;
    else if (next < 0) eles[i] = coords[prev][2] as number;
    else {
      const span = dist[next] - dist[prev];
      const f = span > 0 ? (dist[i] - dist[prev]) / span : 0;
      const a = coords[prev][2] as number;
      eles[i] = a + ((coords[next][2] as number) - a) * f;
    }
  }
  return { eles, estimated };
}
