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
 * One-line verdict of the conditions **while organising** an outing (#1407): weather of the slot at the
 * meeting point, crossed massifs, hunting season. Every missing source is neutral, never blocking.
 * `weather` is injectable for tests (otherwise Open-Meteo through the server cache).
 */
export async function previewConditions(db: Db, i: Input, weather?: WeatherInfo, now = Date.now()): Promise<ConditionsPreview> {
  const date = parisDate(i.startsAt);
  const w = weather ?? (await outingWeather({ startsAt: i.startsAt, meetingLat: i.lat, meetingLon: i.lon }, estimateDurationMin(i.distanceM, i.gainM), now).catch(() => undefined));
  let fire: FireTone | undefined;
  // Fire and hunting: Var-only sources (#1428) that can be turned off (#1473); otherwise neither weighs on the verdict.
  try {
    if (!fireApplies(i.lon, i.lat)) throw new Error('incendie non applicable');
    fire = fireTone(fireInfo(db, massifsForGeometry(db, i.geometry), date, new Date(now)));
  } catch {
    fire = undefined;
  }
  return { tone: overallTone({ fire, weather: w }), hunting: huntingApplies(i.lon, i.lat) ? huntingInfo(date).tone : 'unknown' };
}
