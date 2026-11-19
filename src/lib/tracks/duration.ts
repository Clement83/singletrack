/**
 * Estimated duration of a mountain-bike outing (simple, deliberately cautious formula):
 *   minutes = distance_km / VITESSE_PLAT × 60  +  D+ / VITESSE_ASCENSION × 60
 * - VITESSE_PLAT = 12 km/h (average "steady ride" speed outside climbs);
 * - VITESSE_ASCENSION = 400 m of elevation gain per hour (Naismith's rule adapted to mountain biking).
 * Breaks excluded. Both parameters are exported to be tuned in one place.
 */
export const FLAT_SPEED_KMH = 12;
export const CLIMB_M_PER_H = 400;

export function estimateDurationMin(distanceM: number, gainM: number | null): number {
  const flat = (distanceM / 1000 / FLAT_SPEED_KMH) * 60;
  const climb = gainM ? (gainM / CLIMB_M_PER_H) * 60 : 0;
  return Math.round(flat + climb);
}
