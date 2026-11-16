import { haversine } from '@/lib/geo/distance';
import type { Position } from '@/lib/geo';
import type { RouteScore } from './score';

/**
 * Itinéraires alternatifs façon Waze (#1386) : on garde au plus 2 candidats **réellement différents** du
 * recommandé, chacun résumé par une étiquette courte (« +5 km, plus doux »).
 */
export const MAX_ALTERNATIVES = 2;
/** Au-delà de cette part de tracé commun avec le recommandé (ou une autre alternative), le candidat est écarté. */
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

/** Part (0–1) du tracé `b` qui passe à moins de 25 m du tracé `a`. */
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
 * Étiquette d'une alternative par rapport au recommandé : écart de distance arrondi (0,1 km sous 10 km, 1 km
 * au-delà) et un qualificatif choisi sur les vraies différences (montée évitée ou ajoutée d'abord, sinon distance).
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

/** Au plus `MAX_ALTERNATIVES` candidats différents du recommandé et entre eux, les mieux notés d'abord. */
export function pickAlternatives<T extends { coordinates: Position[]; score: RouteScore }>(best: T, candidates: T[]): (T & AltLabel)[] {
  const kept: T[] = [];
  for (const c of [...candidates].sort((x, y) => x.score.score - y.score.score)) {
    if (c === best || kept.length >= MAX_ALTERNATIVES) continue;
    if ([best, ...kept].some((k) => sharedShare(k.coordinates, c.coordinates) >= MAX_SHARED)) continue;
    kept.push(c);
  }
  return kept.map((c) => ({ ...c, ...describeAlternative(best.score, c.score) }));
}
