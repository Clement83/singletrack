// Météo des sorties (#1350) : lecture d'une réponse Open-Meteo et résumé sur le créneau d'une sortie.
// Logique pure (aucun appel réseau ici), testée avec une vraie réponse dans tests/fixtures/weather/.

/** Variables horaires demandées à Open-Meteo (`timeformat=unixtime`, `timezone=Europe/Paris`). */
export const HOURLY_VARS = ['temperature_2m', 'precipitation_probability', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m', 'weather_code'] as const;
/** Jours de prévision demandés (maximum Open-Meteo) et jours passés (pluie des 48 h avant la sortie). */
export const FORECAST_DAYS = 16;
export const PAST_DAYS = 2;

export type Hour = {
  /** Début de l'heure, en ms. */
  t: number;
  temp: number | null;
  /** Probabilité de pluie, %. */
  pop: number | null;
  /** Cumul de l'heure, mm. */
  rain: number | null;
  wind: number | null;
  gust: number | null;
  code: number | null;
};
export type Forecast = { hours: Hour[]; days: { sunrise: number; sunset: number }[] };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Valide et normalise une réponse Open-Meteo ; lève une erreur si le format n'est pas celui attendu. */
export function parseForecast(json: unknown): Forecast {
  const j = json as { hourly?: Record<string, unknown[]>; daily?: Record<string, unknown[]> } | null;
  const h = j?.hourly;
  const time = h?.time;
  if (!h || !Array.isArray(time) || time.length === 0 || !HOURLY_VARS.every((k) => Array.isArray(h[k]) && h[k].length === time.length)) {
    throw new Error('Réponse Open-Meteo inattendue');
  }
  const hours: Hour[] = time.map((t, i) => ({
    t: Number(t) * 1000,
    temp: num(h.temperature_2m[i]),
    pop: num(h.precipitation_probability[i]),
    rain: num(h.precipitation[i]),
    wind: num(h.wind_speed_10m[i]),
    gust: num(h.wind_gusts_10m[i]),
    code: num(h.weather_code[i]),
  }));
  if (hours.some((x) => !Number.isFinite(x.t))) throw new Error('Réponse Open-Meteo inattendue');
  const d = j?.daily;
  const days =
    d && Array.isArray(d.sunrise) && Array.isArray(d.sunset)
      ? d.sunrise
          .map((s, i) => ({ sunrise: Number(s) * 1000, sunset: Number(d.sunset[i]) * 1000 }))
          .filter((x) => Number.isFinite(x.sunrise) && Number.isFinite(x.sunset))
      : [];
  return { hours, days };
}

/** Familles de temps (codes WMO d'Open-Meteo), de la plus clémente à la plus sévère. */
export type Sky = 'clear' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';
const SKY_ORDER: Sky[] = ['clear', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'storm'];

export function skyOf(code: number | null): Sky | null {
  if (code === null) return null;
  if (code <= 1) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

/** Seuils des alertes (source unique, ajustables ici). */
export const THRESHOLDS = {
  /** Probabilité de pluie (%) à partir de laquelle on prévient. */
  rainProb: 50,
  /** Cumul sur le créneau (mm) : à surveiller / sortie compromise. */
  rainMm: 2,
  rainMmDanger: 10,
  /** Rafales (km/h) : à surveiller / dangereux. */
  gust: 50,
  gustDanger: 80,
  /** Pluie des 48 h précédentes (mm) au-delà de laquelle le terrain est sans doute gras. */
  muddy48h: 10,
};

export type WeatherFlag = 'storm' | 'snow' | 'rain' | 'wind' | 'dark' | 'muddy';
export type WeatherTone = 'ok' | 'warn' | 'danger';

export type WeatherOk = {
  kind: 'ok';
  sky: Sky | null;
  tempMin: number | null;
  tempMax: number | null;
  windMax: number | null;
  gustMax: number | null;
  popMax: number | null;
  rainMm: number;
  /** Pluie des 48 h avant le départ (mm), `null` si ces heures ne sont pas dans la réponse. */
  rain48h: number | null;
  /** Coucher du soleil du jour de la sortie (ms). */
  sunset: number | null;
  /** Fin estimée de la sortie (ms). */
  endsAt: number;
  flags: WeatherFlag[];
  tone: WeatherTone;
};

export type WeatherInfo =
  | { kind: 'past' }
  /** Au-delà de l'horizon : prévision disponible à partir de `availableFrom` (ms). */
  | { kind: 'beyond'; availableFrom: number }
  | { kind: 'unavailable' }
  | WeatherOk;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const present = (v: (number | null)[]) => v.filter((x): x is number => x !== null);
const maxOf = (v: (number | null)[]) => (present(v).length ? Math.max(...present(v)) : null);
const minOf = (v: (number | null)[]) => (present(v).length ? Math.min(...present(v)) : null);
const sum = (v: (number | null)[]) => v.reduce<number>((a, x) => a + (x ?? 0), 0);
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Situation d'une sortie avant tout appel réseau : passée, trop lointaine (au-delà de l'horizon de prévision),
 * ou `null` = il faut une prévision.
 */
export function weatherTiming(startsAt: number, durationMin: number, now: number): WeatherInfo | null {
  const endsAt = startsAt + durationMin * 60_000;
  if (endsAt < now) return { kind: 'past' };
  // Open-Meteo couvre FORECAST_DAYS jours à partir d'aujourd'hui : un jour de marge pour la fin du créneau.
  const span = (FORECAST_DAYS - 1) * DAY;
  if (endsAt > now + span) return { kind: 'beyond', availableFrom: endsAt - span };
  return null;
}

/** Résumé de la prévision sur le créneau de la sortie (départ → départ + durée estimée, 1 h minimum), au RDV. */
export function summarize(f: Forecast, startsAt: number, durationMin: number): WeatherInfo {
  const endsAt = startsAt + Math.max(durationMin, 60) * 60_000;
  const slot = f.hours.filter((h) => h.t + HOUR > startsAt && h.t < endsAt);
  if (slot.length === 0) return { kind: 'unavailable' };

  const first = f.hours[0].t;
  const rain48h = first <= startsAt - 47 * HOUR ? round1(sum(f.hours.filter((h) => h.t >= startsAt - 48 * HOUR && h.t < startsAt).map((h) => h.rain))) : null;
  const day = f.days.find((d) => d.sunrise - 6 * HOUR <= startsAt && startsAt < d.sunset + 6 * HOUR);
  const sunset = day?.sunset ?? null;

  const sky = slot
    .map((h) => skyOf(h.code))
    .reduce<Sky | null>((w, s) => (s && (!w || SKY_ORDER.indexOf(s) > SKY_ORDER.indexOf(w)) ? s : w), null);
  const gustMax = maxOf(slot.map((h) => h.gust));
  const popMax = maxOf(slot.map((h) => h.pop));
  const rainMm = round1(sum(slot.map((h) => h.rain)));

  const flags: WeatherFlag[] = [];
  if (sky === 'storm') flags.push('storm');
  if (sky === 'snow') flags.push('snow');
  if (rainMm >= THRESHOLDS.rainMm || (popMax ?? 0) >= THRESHOLDS.rainProb) flags.push('rain');
  if ((gustMax ?? 0) >= THRESHOLDS.gust) flags.push('wind');
  if (sunset !== null && endsAt > sunset) flags.push('dark');
  if (rain48h !== null && rain48h >= THRESHOLDS.muddy48h) flags.push('muddy');

  const danger = sky === 'storm' || rainMm >= THRESHOLDS.rainMmDanger || (gustMax ?? 0) >= THRESHOLDS.gustDanger;
  return {
    kind: 'ok',
    sky,
    tempMin: minOf(slot.map((h) => h.temp)),
    tempMax: maxOf(slot.map((h) => h.temp)),
    windMax: maxOf(slot.map((h) => h.wind)),
    gustMax,
    popMax,
    rainMm,
    rain48h,
    sunset,
    endsAt,
    flags,
    tone: danger ? 'danger' : flags.length ? 'warn' : 'ok',
  };
}
