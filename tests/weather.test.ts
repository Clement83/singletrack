import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearWeatherCache, forecastUrl, outingWeather, parseForecast, skyOf, summarize, weatherTiming, type Forecast, type WeatherOk,
} from '../src/lib/weather';
import { overallTone } from '../src/lib/conditions';

// Real Open-Meteo answer (Pierrefeu-du-Var, fetched on 2026-11-12): 2 past days + 16 forecast days.
const raw = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/weather/pierrefeu.json'), 'utf8'));
const f = parseForecast(raw);
const H = 3_600_000;
const DAY = 24 * H;
/** 14 November 2026, 9:00 in Paris (UTC+1). */
const J2_9H = Date.UTC(2026, 10, 14, 8);
const NOW = Date.UTC(2026, 10, 12, 14);

describe('météo : lecture de la réponse Open-Meteo', () => {
  it('lit les heures et les levers/couchers du soleil', () => {
    expect(f.hours).toHaveLength(432);
    expect(f.days).toHaveLength(18);
    expect(f.hours[1].t - f.hours[0].t).toBe(H);
    expect(f.days[4].sunset).toBeGreaterThan(f.days[4].sunrise);
  });
  it('refuse un format inattendu', () => {
    expect(() => parseForecast({})).toThrow();
    expect(() => parseForecast(null)).toThrow();
    expect(() => parseForecast({ hourly: { ...raw.hourly, wind_gusts_10m: [1] } })).toThrow();
  });
  it('codes WMO → familles de temps', () => {
    expect([0, 2, 45, 53, 63, 81, 73, 95, null].map(skyOf)).toEqual(['clear', 'cloudy', 'fog', 'drizzle', 'rain', 'rain', 'snow', 'storm', null]);
  });
  it('URL : point arrondi, sans clé, horizon et jours passés', () => {
    const u = new URL(forecastUrl(43.20851, 6.14553));
    expect(u.searchParams.get('latitude')).toBe('43.21');
    expect(u.searchParams.get('forecast_days')).toBe('16');
    expect(u.searchParams.get('past_days')).toBe('2');
    expect(u.searchParams.has('apikey')).toBe(false);
  });
});

describe('météo : créneau de la sortie', () => {
  it('sortie à J+2 : prévision sur le créneau, pluie des 48 h, pas de retour de nuit le matin', () => {
    const w = summarize(f, J2_9H, 150) as WeatherOk;
    expect(w.kind).toBe('ok');
    expect(w.tempMin).not.toBeNull();
    expect(w.tempMax!).toBeGreaterThanOrEqual(w.tempMin!);
    expect(w.tempMax!).toBeLessThan(35);
    expect(w.gustMax!).toBeGreaterThanOrEqual(0);
    expect(w.rain48h).not.toBeNull();
    expect(w.endsAt).toBe(J2_9H + 150 * 60_000);
    expect(w.sunset).not.toBeNull();
    expect(w.flags).not.toContain('dark');
  });
  it('fin après le coucher du soleil (novembre, départ 15 h pour 3 h) → alerte « nuit »', () => {
    const w = summarize(f, J2_9H + 6 * H, 180) as WeatherOk;
    expect(w.flags).toContain('dark');
    expect(w.tone).not.toBe('ok');
  });
  it('pluie des 48 h inconnue si la réponse ne remonte pas assez loin', () => {
    const w = summarize(f, f.hours[0].t + 3 * H, 60) as WeatherOk;
    expect(w.rain48h).toBeNull();
  });
  it('hors de la réponse → non disponible', () => {
    expect(summarize(f, f.hours.at(-1)!.t + 5 * DAY, 120).kind).toBe('unavailable');
  });

  const synth = (patch: Partial<Forecast['hours'][number]>, before: Partial<Forecast['hours'][number]> = {}): Forecast => {
    const start = Date.UTC(2026, 5, 10, 6);
    const hours = Array.from({ length: 72 }, (_, i) => ({
      t: start + (i - 48) * H, temp: 20, pop: 0, rain: 0, wind: 10, gust: 20, code: 0, ...(i < 48 ? before : patch),
    }));
    return { hours, days: [{ sunrise: start - 2 * H, sunset: start + 14 * H }] };
  };
  const at = Date.UTC(2026, 5, 10, 6);
  it('beau temps → ok, aucune alerte', () => {
    const w = summarize(synth({}), at, 180) as WeatherOk;
    expect(w).toMatchObject({ tone: 'ok', flags: [], sky: 'clear', rainMm: 0, rain48h: 0 });
  });
  it('orage → sortie compromise', () => {
    expect(summarize(synth({ code: 95 }), at, 120)).toMatchObject({ tone: 'danger', flags: ['storm'] });
  });
  it('pluie probable, rafales, terrain gras → à surveiller', () => {
    const w = summarize(synth({ pop: 70, gust: 55 }, { rain: 0.5 }), at, 120) as WeatherOk;
    expect(w.tone).toBe('warn');
    expect(w.flags).toEqual(['rain', 'wind', 'muddy']);
    expect(w.rain48h).toBe(24);
  });
  it('gros cumul ou rafales très fortes → sortie compromise', () => {
    expect(summarize(synth({ rain: 6, code: 63 }), at, 120).kind === 'ok' && (summarize(synth({ rain: 6, code: 63 }), at, 120) as WeatherOk).tone).toBe('danger');
    expect((summarize(synth({ gust: 90 }), at, 120) as WeatherOk).tone).toBe('danger');
  });
});

describe('météo : avant tout appel', () => {
  it('sortie passée', () => {
    expect(weatherTiming(NOW - 5 * H, 120, NOW)).toEqual({ kind: 'past' });
  });
  it('au-delà de l’horizon (J+30) : date de disponibilité', () => {
    const start = NOW + 30 * DAY;
    const w = weatherTiming(start, 120, NOW);
    expect(w?.kind).toBe('beyond');
    if (w?.kind === 'beyond') {
      expect(w.availableFrom).toBe(start + 120 * 60_000 - 15 * DAY);
      expect(weatherTiming(start, 120, w.availableFrom)).toBeNull();
    }
  });
  it('dans l’horizon : il faut une prévision', () => {
    expect(weatherTiming(NOW + 2 * DAY, 120, NOW)).toBeNull();
  });
});

describe('météo : appel serveur et cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearWeatherCache();
  });
  const outing = { startsAt: new Date(J2_9H), meetingLat: 43.2085, meetingLon: 6.1455 };

  it('appelle Open-Meteo une fois puis sert le cache', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await outingWeather(outing, 150, NOW)).kind).toBe('ok');
    expect((await outingWeather({ ...outing, meetingLat: 43.2101 }, 150, NOW + 10 * 60_000)).kind).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'User-Agent': 'singletrack-weather/1.0' });
  });
  it('API en panne ou réponse invalide → non disponible, sans exception', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 503 })));
    expect(await outingWeather(outing, 150, NOW)).toEqual({ kind: 'unavailable' });
    clearWeatherCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":true}', { status: 200 })));
    expect(await outingWeather(outing, 150, NOW)).toEqual({ kind: 'unavailable' });
    clearWeatherCache();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('réseau'); }));
    expect(await outingWeather(outing, 150, NOW)).toEqual({ kind: 'unavailable' });
  });
  it('sortie passée ou lointaine : aucun appel', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await outingWeather({ ...outing, startsAt: new Date(NOW - DAY) }, 120, NOW)).kind).toBe('past');
    expect((await outingWeather({ ...outing, startsAt: new Date(NOW + 40 * DAY) }, 120, NOW)).kind).toBe('beyond');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Conditions : verdict global', () => {
  const ok = summarize(f, J2_9H, 150);
  it('combine incendie et météo, la pire gagne', () => {
    expect(overallTone({})).toBe('unknown');
    expect(overallTone({ fire: 'muted', weather: { kind: 'unavailable' } })).toBe('unknown');
    expect(overallTone({ fire: 'ok' })).toBe('ok');
    expect(overallTone({ fire: 'muted', weather: { ...(ok as WeatherOk), tone: 'ok' } })).toBe('ok');
    expect(overallTone({ fire: 'ok', weather: { ...(ok as WeatherOk), tone: 'warn' } })).toBe('warn');
    expect(overallTone({ fire: 'danger', weather: { ...(ok as WeatherOk), tone: 'ok' } })).toBe('danger');
  });
});
