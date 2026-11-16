import type { TrackGeometry } from '@/lib/geo/types';
import { geometryStats } from '@/lib/geo';
import { slopeSegments } from '@/lib/geo/slopes';

/**
 * Notation des itinéraires (#1385, barème validé par Clément en #1379) : coût en « km-effort » = distance +
 * pénalité de montée. Sous un seuil de pente, seule la distance compte ; au-delà, chaque 100 m de D+ vaut
 * ~1 km à 5 %, ~2 km à 10 %, ~4 km à 15 % (`2^((pente − 5) / 5)`, croît plus vite que la pente).
 * Deux jeux de réglages : musculaire et VAE (le moteur absorbe les montées moyennes).
 */
export type Rider = 'muscle' | 'ebike';
export const RIDERS: Rider[] = ['muscle', 'ebike'];

export const RIDER_SETTINGS: Record<Rider, { thresholdPct: number; weight: number; detourK: number; profile: string }> = {
  muscle: { thresholdPct: 4, weight: 1, detourK: 1, profile: 'singletrack' },
  ebike: { thresholdPct: 8, weight: 0.5, detourK: 1, profile: 'singletrack-vae' },
};

/** Pénalité (km) pour 100 m de D+ à une pente donnée (%). 0 sous le seuil du cycliste. */
export function climbPenaltyPer100m(gradePct: number, rider: Rider): number {
  const s = RIDER_SETTINGS[rider];
  if (gradePct <= s.thresholdPct) return 0;
  return s.weight * 2 ** ((gradePct - 5) / 5);
}

export type RouteScore = { km: number; gainM: number | null; lossM: number | null; effortKm: number; score: number };

/** Score d'une géométrie : sans altitude, la distance seule (pas de pénalité inventée). */
export function scoreRoute(geometry: TrackGeometry, rider: Rider): RouteScore {
  const st = geometryStats(geometry);
  const km = st.distanceM / 1000;
  let effortKm = 0;
  for (const s of slopeSegments(geometry)) {
    if (s.grade <= 0) continue;
    const climbM = (s.grade / 100) * (s.toKm - s.fromKm) * 1000;
    effortKm += (climbM / 100) * climbPenaltyPer100m(s.grade, rider);
  }
  return { km, gainM: st.gainM, lossM: st.lossM, effortKm, score: km + effortKm };
}

export type Candidate<T> = { route: T; score: RouteScore };

/**
 * Meilleur candidat : score le plus bas parmi ceux dont le détour est proportionné à l'effort évité par rapport
 * au plus court (`km_en_plus ≤ k × effort_évité`). « 10 km de plus pour éviter une petite montée, non ; 1 km
 * de plus pour éviter une grosse montée, oui. »
 */
export function chooseRoute<T>(candidates: Candidate<T>[], rider: Rider): { best: Candidate<T>; shortest: Candidate<T> } {
  if (!candidates.length) throw new Error('no candidate');
  const shortest = candidates.reduce((a, b) => (b.score.km < a.score.km ? b : a));
  const k = RIDER_SETTINGS[rider].detourK;
  const ok = candidates.filter((c) => {
    const extra = c.score.km - shortest.score.km;
    const avoided = shortest.score.effortKm - c.score.effortKm;
    return extra <= 1e-9 || extra <= k * avoided;
  });
  const best = ok.reduce((a, b) => (b.score.score < a.score.score ? b : a), shortest);
  return { best, shortest };
}
