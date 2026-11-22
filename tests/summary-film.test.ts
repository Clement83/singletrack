import { describe, expect, it } from 'vitest';
import { buildFlyPath } from '@/lib/geo/flyover';
import { buildFilm, filmMediaMs, FILM_FPS, INTRO_MS, MIN_PHOTO_MS, musicEnvelope, OUTRO_MS, videoBitrate } from '@/lib/outings/summary-film';
import { buildSlides, buildStops, cruiseMps, PHOTO_MS, type SummaryMedia } from '@/lib/outings/summary-script';

// A straight 2 km line eastwards.
const path = buildFlyPath({ type: 'LineString', coordinates: Array.from({ length: 21 }, (_, i) => [6 + i * 0.00123, 43.2]) });
const m = (id: string, d: number | null, type: 'photo' | 'video' = 'photo', durationMs: number | null = null): SummaryMedia => ({ id, type, author: '', durationMs, distanceM: d });
const film = (media: SummaryMedia[]) => buildFilm({ path, stops: buildStops(media), slides: buildSlides(media), profileKm: null, grades: [] });
const ids = (f: ReturnType<typeof film>) => [...new Set(f.frames.flatMap((x) => (x.media ? [x.media.m.id] : [])))];

describe('film de l’export (#1707)', () => {
  it('sans média : intro, trajet complet à la vitesse de croisière, fin ; distance croissante jusqu’au bout', () => {
    const f = film([]);
    const rideS = path.totalM / cruiseMps(path.totalM);
    expect(f.durationMs / 1000).toBeCloseTo(INTRO_MS / 1000 + rideS + OUTRO_MS / 1000, 0);
    expect(f.frames.at(-1)!.dist).toBe(path.totalM);
    expect(f.frames.every((x, i) => i === 0 || x.dist >= f.frames[i - 1].dist)).toBe(true);
    expect(f.clips).toEqual([]);
  });
  it('photo : le point s’arrête 3 s sur l’arrêt ; ordre arrêts puis diaporama', () => {
    const f = film([m('a', 500), m('z', null), m('b', 1500)]);
    expect(ids(f)).toEqual(['a', 'b', 'z']);
    const onA = f.frames.filter((x) => x.media?.m.id === 'a');
    expect(onA).toHaveLength((PHOTO_MS * FILM_FPS) / 1000);
    expect(new Set(onA.map((x) => x.dist))).toEqual(new Set([500]));
    expect(onA.at(-1)!.media!.atMs).toBeCloseTo(PHOTO_MS - 1000 / FILM_FPS);
  });
  it('vidéo : le point roule pendant le clip ; un arrêt atteint attend la fin du clip (#1705)', () => {
    const f = film([m('v', 300, 'video', 20_000), m('p', 600)]);
    const onV = f.frames.filter((x) => x.media?.m.id === 'v');
    expect(onV).toHaveLength(20 * FILM_FPS);
    expect(onV[0].dist).toBe(300);
    expect(onV.at(-1)!.dist).toBe(600); // reached p during the clip, held there
    const onP = f.frames.filter((x) => x.media?.m.id === 'p');
    expect(onP[0].dist).toBe(600);
    expect(f.clips).toEqual([{ id: 'v', startMs: expect.any(Number), durMs: 20_000 }]);
    expect(f.clips[0].startMs).toBeCloseTo((f.frames.indexOf(onV[0]) * 1000) / FILM_FPS);
  });
  it('durée d’un média : photo 3 s, vidéo sa durée (10 s si inconnue)', () => {
    expect(filmMediaMs({ type: 'photo', durationMs: null })).toBe(PHOTO_MS);
    expect(filmMediaMs({ type: 'video', durationMs: 4200 })).toBe(4200);
    expect(filmMediaMs({ type: 'video', durationMs: null })).toBe(10_000);
  });
});

describe('vitesse de l’export (#1711)', () => {
  const media = [m('p', 500), m('v', 1500, 'video', 6000)];
  const at = (speed: number) => buildFilm({ path, stops: buildStops(media), slides: [], profileKm: null, grades: [], speed });
  it('trajet ÷ vitesse, photo 3 s ÷ vitesse (1,5 s mini), clip à sa durée réelle', () => {
    const bare = (speed: number) => buildFilm({ path, stops: [], slides: [], profileKm: null, grades: [], speed }).frames.length - ((INTRO_MS + OUTRO_MS) * FILM_FPS) / 1000;
    expect(bare(1) / bare(4)).toBeCloseTo(4, 1);
    expect(filmMediaMs({ type: 'photo', durationMs: null }, 2)).toBe(1500);
    expect(filmMediaMs({ type: 'photo', durationMs: null }, 6)).toBe(MIN_PHOTO_MS);
    expect(filmMediaMs({ type: 'video', durationMs: 6000 }, 6)).toBe(6000);
    expect(at(6).clips[0].durMs).toBe(6000);
    expect(at(6).durationMs).toBeLessThan(at(1).durationMs);
  });
  it('le point roule plus vite sous un clip', () => {
    const under = (f: ReturnType<typeof at>) => { const v = f.frames.filter((x) => x.media?.m.id === 'v'); return v.at(-1)!.dist - v[0].dist; };
    expect(under(at(2))).toBeGreaterThan(under(at(1)) * 1.5);
  });
});

describe('volume de la musique', () => {
  const gainAt = (pts: { t: number; g: number }[], t: number) => {
    const i = pts.findIndex((p) => p.t >= t);
    if (i <= 0) return pts[Math.max(0, i)].g;
    const a = pts[i - 1], b = pts[i];
    return b.t === a.t ? b.g : a.g + ((b.g - a.g) * (t - a.t)) / (b.t - a.t);
  };
  it('fondu d’entrée et de sortie, baissée sous les clips, points dans l’ordre', () => {
    const pts = musicEnvelope([{ startMs: 10_000, durMs: 5000 }], 30_000);
    expect(pts.every((p, i) => i === 0 || p.t >= pts[i - 1].t)).toBe(true);
    expect(gainAt(pts, 0)).toBe(0);
    expect(gainAt(pts, 5)).toBeCloseTo(0.8);
    expect(gainAt(pts, 12)).toBeCloseTo(0.2);
    expect(gainAt(pts, 20)).toBeCloseTo(0.8);
    expect(pts.at(-1)).toEqual({ t: 30, g: 0 });
  });
  it('clips rapprochés fusionnés : pas de remontée entre eux', () => {
    const pts = musicEnvelope([{ startMs: 10_000, durMs: 4000 }, { startMs: 14_300, durMs: 4000 }], 40_000);
    expect(gainAt(pts, 14.15)).toBeCloseTo(0.2);
  });
  it('clip jusqu’à la fin : le fondu part du niveau baissé', () => {
    const pts = musicEnvelope([{ startMs: 25_000, durMs: 5000 }], 30_000);
    expect(gainAt(pts, 27.5)).toBeCloseTo(0.2);
    expect(gainAt(pts, 30)).toBe(0);
  });
});

describe('débit vidéo de l’export (#1710)', () => {
  it('≈ 20 Mb/s en 1080p30, plafonné à 24 Mb/s, plancher 2 Mb/s', () => {
    expect(videoBitrate(1920, 1080, 30)).toBeGreaterThanOrEqual(19_000_000);
    expect(videoBitrate(1920, 1080, 30)).toBeLessThanOrEqual(24_000_000);
    expect(videoBitrate(1080, 1920, 30)).toBe(videoBitrate(1920, 1080, 30));
    expect(videoBitrate(3840, 2160, 60)).toBe(24_000_000);
    expect(videoBitrate(270, 480, 30)).toBe(2_000_000);
  });
});
