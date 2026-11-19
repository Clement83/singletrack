import type { TrackGeometry } from '@/lib/geo/types';
import { geometryStats } from '@/lib/geo';
import { slopeSegments } from '@/lib/geo/slopes';

/**
 * Route scoring (#1385, scale validated by the maintainer in #1379): cost in "effort-km" = distance +
 * climbing penalty. Below a slope threshold, only distance counts; above it, each 100 m of gain is worth
 * ~1 km at 5 %, ~2 km at 10 %, ~4 km at 15 % (`2^((slope − 5) / 5)`, grows faster than the slope).
 * Two sets of settings: muscle bike and e-bike (the motor absorbs medium climbs).
 */
export type Rider = 'muscle' | 'ebike';
export const RIDERS: Rider[] = ['muscle', 'ebike'];

export const RIDER_SETTINGS: Record<Rider, { thresholdPct: number; weight: number; detourK: number; profile: string }> = {
  muscle: { thresholdPct: 4, weight: 1, detourK: 1, profile: 'singletrack' },
  ebike: { thresholdPct: 8, weight: 0.5, detourK: 1, profile: 'singletrack-vae' },
};

/** Penalty (km) per 100 m of gain at a given slope (%). 0 below the rider's threshold. */
export function climbPenaltyPer100m(gradePct: number, rider: Rider): number {
  const s = RIDER_SETTINGS[rider];
  if (gradePct <= s.thresholdPct) return 0;
  return s.weight * 2 ** ((gradePct - 5) / 5);
}

export type RouteScore = { km: number; gainM: number | null; lossM: number | null; effortKm: number; score: number };

/** Score of a geometry: without elevation, distance only (no made-up penalty). */
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
 * Best candidate: lowest score among those whose detour is proportionate to the effort avoided compared
 * with the shortest (`extra_km ≤ k × effort_avoided`). "10 km more to avoid a small climb, no; 1 km
 * more to avoid a big climb, yes."
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
