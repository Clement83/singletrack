import { sourceEnabled } from '@/lib/config';
import { FORECAST_DAYS, HOURLY_VARS, PAST_DAYS, parseForecast, summarize, weatherTiming, type Forecast, type WeatherInfo } from './forecast';

// Appels Open-Meteo (#1350), côté serveur uniquement : jamais depuis le navigateur d'un invité.
// Sans clé (usage non commercial). Cache mémoire par point arrondi à 0,01° (≈ 1 km) :
// 1 h pour une réponse, 10 min pour un échec (on ne martèle pas une API en panne).

const API = process.env.OPEN_METEO_URL ?? 'https://api.open-meteo.com/v1/forecast';
const OK_TTL = 60 * 60_000;
const FAIL_TTL = 10 * 60_000;
const TIMEOUT_MS = 4000;

type Entry = { at: number; ttl: number; value: Promise<Forecast | null> };
const cache = new Map<string, Entry>();

export function forecastUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    hourly: HOURLY_VARS.join(','),
    daily: 'sunrise,sunset',
    timezone: 'Europe/Paris',
    timeformat: 'unixtime',
    past_days: String(PAST_DAYS),
    forecast_days: String(FORECAST_DAYS),
  });
  return `${API}?${q}`;
}

async function load(lat: number, lon: number): Promise<Forecast | null> {
  try {
    const res = await fetch(forecastUrl(lat, lon), {
      headers: { 'User-Agent': 'singletrack-weather/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    return parseForecast(await res.json());
  } catch (e) {
    console.warn('[weather] prévision indisponible :', String(e));
    return null;
  }
}

/** Prévision au point, mise en cache ; `null` si l'API ne répond pas ou répond n'importe quoi. */
export function getForecast(lat: number, lon: number, now = Date.now()): Promise<Forecast | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  const entry: Entry = { at: now, ttl: OK_TTL, value: load(lat, lon) };
  void entry.value.then((v) => {
    if (!v) entry.ttl = FAIL_TTL;
  });
  cache.set(key, entry);
  return entry.value;
}

/** Vide le cache (tests). */
export const clearWeatherCache = () => cache.clear();

/**
 * Météo d'une sortie (départ, durée estimée, point de RDV). N'appelle Open-Meteo que si la sortie est dans
 * l'horizon de prévision ; toute panne donne `unavailable` : la page ne casse jamais.
 */
export async function outingWeather(
  o: { startsAt: Date; meetingLat: number; meetingLon: number },
  durationMin: number,
  now = Date.now(),
): Promise<WeatherInfo> {
  const start = o.startsAt.getTime();
  const early = weatherTiming(start, durationMin, now);
  if (early) return early;
  if (!sourceEnabled('openmeteo')) return { kind: 'unavailable' };
  const f = await getForecast(o.meetingLat, o.meetingLon, now);
  return f ? summarize(f, start, durationMin) : { kind: 'unavailable' };
}
