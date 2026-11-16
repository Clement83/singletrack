import { describe, expect, it } from 'vitest';
import { openDb } from '@/db';
import { previewConditions } from '@/lib/conditions-preview';
import type { TrackGeometry } from '@/lib/geo';
import type { WeatherOk } from '@/lib/weather';

// Verdict de l'écran d'organisation (#1407) : chaque source manquante est neutre.
const geometry: TrackGeometry = { type: 'LineString', coordinates: [[6.14, 43.2, 100], [6.15, 43.21, 150]] };
const base = { geometry, distanceM: 1500, gainM: 50, lat: 43.2, lon: 6.14 };
const sunny: WeatherOk = {
  kind: 'ok', sky: 'clear', tempMin: 10, tempMax: 15, windMax: 10, gustMax: 20, popMax: 0, rainMm: 0, rain48h: 0,
  sunset: null, endsAt: 0, flags: [], tone: 'ok',
};

describe('conditions pendant l’organisation d’une sortie (#1407)', () => {
  const { db } = openDb(':memory:');
  it('beau temps, massifs pas encore importés, chasse ouverte → « tout est bon » + chasse possible', async () => {
    const r = await previewConditions(db, { ...base, startsAt: new Date('2026-11-20T08:00:00Z') }, sunny);
    expect(r).toEqual({ tone: 'ok', hunting: 'caution' });
  });
  it('orage → compromis', async () => {
    const r = await previewConditions(db, { ...base, startsAt: new Date('2026-11-20T08:00:00Z') }, { ...sunny, tone: 'danger', flags: ['storm'] });
    expect(r.tone).toBe('danger');
  });
  it('rien de connu (prévision au-delà de l’horizon, hors arrêtés de chasse) → inconnu, sans erreur', async () => {
    const r = await previewConditions(db, { ...base, startsAt: new Date('2027-07-01T07:00:00Z') }, { kind: 'beyond', availableFrom: 0 });
    expect(r).toEqual({ tone: 'unknown', hunting: 'unknown' });
  });
  it('avril : pas de chasse', async () => {
    const r = await previewConditions(db, { ...base, startsAt: new Date('2027-04-10T07:00:00Z') }, sunny);
    expect(r.hunting).toBe('ok');
  });
});
