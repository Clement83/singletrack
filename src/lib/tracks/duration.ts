/**
 * Durée estimée d'une sortie VTT (formule simple, volontairement prudente) :
 *   minutes = distance_km / VITESSE_PLAT × 60  +  D+ / VITESSE_ASCENSION × 60
 * - VITESSE_PLAT = 12 km/h (vitesse moyenne « balade soutenue » hors montée) ;
 * - VITESSE_ASCENSION = 400 m de D+ par heure (règle de Naismith adaptée au VTT).
 * Hors pauses. Les deux paramètres sont exportés pour être ajustés au même endroit.
 */
export const FLAT_SPEED_KMH = 12;
export const CLIMB_M_PER_H = 400;

export function estimateDurationMin(distanceM: number, gainM: number | null): number {
  const flat = (distanceM / 1000 / FLAT_SPEED_KMH) * 60;
  const climb = gainM ? (gainM / CLIMB_M_PER_H) * 60 : 0;
  return Math.round(flat + climb);
}
