// Outing weather (#1350): reading an Open-Meteo answer and summary over an outing's slot.
// Pure logic (no network call here), tested with a real answer in tests/fixtures/weather/.

/** Hourly variables asked from Open-Meteo (`timeformat=unixtime`, `timezone=Europe/Paris`). */
export const HOURLY_VARS = ['temperature_2m', 'precipitation_probability', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m', 'weather_code'] as const;
/** Forecast days requested (Open-Meteo maximum) and past days (rain of the 48 h before the outing). */
export const FORECAST_DAYS = 16;
export const PAST_DAYS = 2;

export type Hour = {
  /** Start of the hour, in ms. */
  t: number;
  temp: number | null;
  /** Probability of rain, %. */
  pop: number | null;
  /** Total for the hour, mm. */
  rain: number | null;
  wind: number | null;
  gust: number | null;
  code: number | null;
};
export type Forecast = { hours: Hour[]; days: { sunrise: number; sunset: number }[] };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Validates and normalises an Open-Meteo answer; throws if the format is not the expected one. */
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

/** Weather families (Open-Meteo WMO codes), mildest to most severe. */
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

/** Alert thresholds (single source, tunable here). */
export const THRESHOLDS = {
  /** Probability of rain (%) from which we warn. */
  rainProb: 50,
  /** Total over the slot (mm): to watch / outing compromised. */
  rainMm: 2,
  rainMmDanger: 10,
  /** Gusts (km/h): to watch / dangerous. */
  gust: 50,
  gustDanger: 80,
  /** Rain of the previous 48 h (mm) beyond which the ground is probably muddy. */
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
  /** Rain of the 48 h before the start (mm), `null` if those hours are not in the answer. */
  rain48h: number | null;
  /** Sunset on the outing's day (ms). */
  sunset: number | null;
  /** Estimated end of the outing (ms). */
  endsAt: number;
  flags: WeatherFlag[];
  tone: WeatherTone;
};

export type WeatherInfo =
  | { kind: 'past' }
  /** Beyond the horizon: forecast available from `availableFrom` (ms). */
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
 * Situation of an outing before any network call: past, too far ahead (beyond the forecast horizon),
 * or `null` = a forecast is needed.
 */
export function weatherTiming(startsAt: number, durationMin: number, now: number): WeatherInfo | null {
  const endsAt = startsAt + durationMin * 60_000;
  if (endsAt < now) return { kind: 'past' };
  // Open-Meteo covers FORECAST_DAYS days from today: one day of margin for the end of the slot.
  const span = (FORECAST_DAYS - 1) * DAY;
  if (endsAt > now + span) return { kind: 'beyond', availableFrom: endsAt - span };
  return null;
}

/** Summary of the forecast over the outing's slot (start → start + estimated duration, 1 h minimum), at the meeting point. */
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
