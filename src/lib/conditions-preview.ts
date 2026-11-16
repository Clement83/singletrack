import type { Db } from '@/db';
import { fireInfo, fireTone, massifsForGeometry, parisDate, type FireTone } from '@/lib/fire';
import type { TrackGeometry } from '@/lib/geo/types';
import { huntingInfo, type HuntingTone } from '@/lib/hunting';
import { estimateDurationMin } from '@/lib/tracks/duration';
import { outingWeather, type WeatherInfo } from '@/lib/weather';
import { fireApplies, huntingApplies } from '@/lib/osm/zones';
import { overallTone, type OverallTone } from './conditions';

export type ConditionsPreview = { tone: OverallTone; hunting: HuntingTone };

type Input = {
  geometry: TrackGeometry;
  distanceM: number;
  gainM: number | null;
  startsAt: Date;
  lat: number;
  lon: number;
};

/**
 * Verdict en une ligne des conditions **pendant qu'on organise** une sortie (#1407) : météo du créneau au
 * point de RDV, massifs traversés, saison de chasse. Chaque source manquante est neutre, jamais bloquante.
 * `weather` est injectable pour les tests (sinon Open-Meteo via le cache serveur).
 */
export async function previewConditions(db: Db, i: Input, weather?: WeatherInfo, now = Date.now()): Promise<ConditionsPreview> {
  const date = parisDate(i.startsAt);
  const w = weather ?? (await outingWeather({ startsAt: i.startsAt, meetingLat: i.lat, meetingLon: i.lon }, estimateDurationMin(i.distanceM, i.gainM), now).catch(() => undefined));
  let fire: FireTone | undefined;
  // Incendie et chasse : sources du Var seulement (#1428) et activables (#1473) ; sinon ni l'un ni l'autre ne pèse sur le verdict.
  try {
    if (!fireApplies(i.lon, i.lat)) throw new Error('incendie non applicable');
    fire = fireTone(fireInfo(db, massifsForGeometry(db, i.geometry), date, new Date(now)));
  } catch {
    fire = undefined;
  }
  return { tone: overallTone({ fire, weather: w }), hunting: huntingApplies(i.lon, i.lat) ? huntingInfo(date).tone : 'unknown' };
}
