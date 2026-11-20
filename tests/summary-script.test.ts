import { describe, expect, it } from 'vitest';
import {
  advanceFly, buildSlides, buildStops, cruiseMps, distanceOfProgress, mediaDurationMs, MIN_SLOW, nextStopIndex, prevStopIndex,
  progressOf, speedFactor, type SummaryMedia,
} from '@/lib/outings/summary-script';

const m = (id: string, d: number | null, type: 'photo' | 'video' = 'photo'): SummaryMedia => ({ id, type, author: 'A', durationMs: type === 'video' ? 8000 : null, distanceM: d });

describe('ordonnancement des médias', () => {
  const media = [m('c', 3000), m('x', null), m('a', 500), m('b', 520, 'video'), m('y', null)];
  it('groupe les médias proches en un arrêt, dans l’ordre de la trace', () => {
    const stops = buildStops(media);
    expect(stops.map((s) => s.media.map((x) => x.id))).toEqual([['a', 'b'], ['c']]);
    expect(stops.map((s) => s.distanceM)).toEqual([500, 3000]);
  });
  it('diaporama final = les médias non placés', () => {
    expect(buildSlides(media).map((x) => x.id)).toEqual(['x', 'y']);
  });
  it('arrêt suivant et précédent', () => {
    const stops = buildStops(media);
    expect(nextStopIndex(stops, 0)).toBe(0);
    expect(nextStopIndex(stops, 500)).toBe(1);
    expect(nextStopIndex(stops, 3500)).toBe(2);
    expect(prevStopIndex(stops, 2000, null)).toBe(0);
    expect(prevStopIndex(stops, 300, null)).toBe(-1);
    expect(prevStopIndex(stops, 3000, 1)).toBe(0);
  });
});

describe('ralenti et arrêt', () => {
  it('vitesse pleine loin, ralentie près de l’arrêt', () => {
    expect(speedFactor(0, 1000)).toBe(1);
    expect(speedFactor(0, null)).toBe(1);
    expect(speedFactor(940, 1000)).toBeCloseTo(0.6, 5);
    expect(speedFactor(1000, 1000)).toBe(MIN_SLOW);
  });
  it('film de 60 à 120 s hors médias', () => {
    expect(cruiseMps(10_000)).toBeCloseTo(10_000 / 60);
    expect(cruiseMps(100_000)).toBeCloseTo(100_000 / 120);
  });
  it('le point s’arrête exactement sur le média et le signale', () => {
    const stops = buildStops([m('a', 100)]);
    let d = 0;
    let reached: number | null = null;
    for (let i = 0; i < 1000 && reached == null; i++) ({ distM: d, reached } = advanceFly(d, 0.1, 10_000, 1, stops, 0));
    expect(reached).toBe(0);
    expect(d).toBe(100);
  });
  it('sans arrêt restant, va jusqu’à la fin sans dépasser', () => {
    const r = advanceFly(9990, 10, 10_000, 4, [], 0);
    expect(r).toEqual({ distM: 10_000, reached: null });
  });
});

describe('durées et progression', () => {
  it('photo 3 s (÷ vitesse), vidéo = durée + marge', () => {
    expect(mediaDurationMs(m('a', 1), 1)).toBe(3000);
    expect(mediaDurationMs(m('a', 1), 2)).toBe(1500);
    expect(mediaDurationMs(m('v', 1, 'video'), 1)).toBe(11_000);
  });
  it('barre : trajet puis diaporama', () => {
    expect(progressOf(5000, 10_000, null, 0)).toBe(0.5);
    expect(progressOf(10_000, 10_000, null, 2)).toBeCloseTo(0.9);
    expect(progressOf(10_000, 10_000, 1, 2)).toBeCloseTo(1);
    expect(distanceOfProgress(0.45, 10_000, 2)).toBeCloseTo(5000);
    expect(distanceOfProgress(0.99, 10_000, 2)).toBe(10_000);
  });
});
