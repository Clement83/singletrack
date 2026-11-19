import { haversine } from '@/lib/geo/distance';
import type { Position } from '@/lib/geo';
import type { RouteScore } from './score';

/**
 * Waze-style alternative routes (#1386): at most 2 candidates **really different** from the
 * recommended one are kept, each summed up by a short label ("+5 km, gentler").
 */
export const MAX_ALTERNATIVES = 2;
/** Beyond this share of line in common with the recommended one (or another alternative), the candidate is dropped. */
export const MAX_SHARED = 0.7;
const SAMPLE_M = 25;
const NEAR_M = 25;

function sample(line: Position[], stepM = SAMPLE_M): Position[] {
  const out: Position[] = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const d = haversine(line[i - 1], line[i]);
    let t = stepM - carry;
    while (t <= d) {
      const f = t / d;
      out.push([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * f, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * f]);
      t += stepM;
    }
    carry = (carry + d) % stepM;
  }
  return out;
}

/** Share (0–1) of line `b` that passes within 25 m of line `a`. */
export function sharedShare(a: Position[], b: Position[]): number {
  const sa = sample(a);
  const sb = sample(b);
  if (!sb.length) return 1;
  const near = sb.filter((p) => sa.some((q) => haversine(p, q) <= NEAR_M)).length;
  return near / sb.length;
}

export type Quality = 'gentler' | 'steeper' | 'shorter' | 'longer';
export type AltLabel = { deltaKm: number; quality: Quality };

/**
 * Label of an alternative relative to the recommended one: distance difference rounded (0.1 km under 10 km, 1 km
 * above) and a qualifier chosen from the real differences (climb avoided or added first, otherwise distance).
 */
export function describeAlternative(best: RouteScore, alt: RouteScore): AltLabel {
  const raw = alt.km - best.km;
  const deltaKm = Math.abs(raw) < 10 ? Math.round(raw * 10) / 10 : Math.round(raw);
  const dGain = best.gainM !== null && alt.gainM !== null ? alt.gainM - best.gainM : 0;
  const dEffort = alt.effortKm - best.effortKm;
  if (dGain <= -20 || dEffort <= -0.3) return { deltaKm, quality: 'gentler' };
  if (dGain >= 20 || dEffort >= 0.3) return { deltaKm, quality: 'steeper' };
  return { deltaKm, quality: raw < 0 ? 'shorter' : 'longer' };
}

/** At most `MAX_ALTERNATIVES` candidates different from the recommended one and from each other, best scored first. */
export function pickAlternatives<T extends { coordinates: Position[]; score: RouteScore }>(best: T, candidates: T[]): (T & AltLabel)[] {
  const kept: T[] = [];
  for (const c of [...candidates].sort((x, y) => x.score.score - y.score.score)) {
    if (c === best || kept.length >= MAX_ALTERNATIVES) continue;
    if ([best, ...kept].some((k) => sharedShare(k.coordinates, c.coordinates) >= MAX_SHARED)) continue;
    kept.push(c);
  }
  return kept.map((c) => ({ ...c, ...describeAlternative(best.score, c.score) }));
}
