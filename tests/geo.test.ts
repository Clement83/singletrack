import { config } from '@/lib/config';
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  haversine, lineLength, gainLoss, elevationStats, bboxOf, startOf, isLoop, geometryStats,
  simplifyLine, parseGpx, enrichElevation, profileOf, type Position, type TrackGeometry,
} from '@/lib/geo';

const gpx = fs.readFileSync(path.join(__dirname, 'fixtures/reference.gpx'), 'utf8');

describe('lib/geo distance', () => {
  it('1° de latitude ≈ 111,19 km', () => {
    expect(haversine([6, 43], [6, 44])).toBeCloseTo(111_195, -2);
  });
  it('distance nulle, et longueur d’une ligne', () => {
    expect(haversine([6, 43], [6, 43])).toBe(0);
    expect(lineLength([[6, 43], [6, 44], [6, 45]])).toBeCloseTo(222_390, -2);
    expect(lineLength([])).toBe(0);
  });
});

describe('lib/geo GPX de référence', () => {
  const { name, geometry } = parseGpx(gpx);
  it('lit nom, points et altitudes', () => {
    expect(name).toBe('Boucle & test');
    expect(geometry.type).toBe('LineString');
    expect((geometry as { coordinates: Position[] }).coordinates).toHaveLength(201);
  });
  it('distance ≈ 4 km, boucle, bbox et départ', () => {
    const s = geometryStats(geometry);
    expect(s.distanceM).toBeGreaterThan(3990);
    expect(s.distanceM).toBeLessThan(4010);
    expect(s.loop).toBe(true);
    expect(s.start).toEqual([6.1469, 43.2269]);
    expect(s.bbox!.minLat).toBeCloseTo(43.2269, 6);
    expect(s.bbox!.maxLat).toBeCloseTo(43.2269 + 2000 / 111195, 5);
  });
  it('GPS bruité (lissage 5 + seuil 3 m) : D+ proche de 100 m, alors que la somme brute est surestimée', () => {
    const coords = (geometry as { coordinates: Position[] }).coordinates;
    const eles = coords.map((p) => p[2] as number);
    let raw = 0;
    for (let i = 1; i < eles.length; i++) if (eles[i] > eles[i - 1]) raw += eles[i] - eles[i - 1];
    const s = elevationStats([coords], { window: 5, thresholdM: 3 });
    expect(raw).toBeGreaterThan(150);
    expect(s.gainM!).toBeGreaterThan(90);
    expect(s.gainM!).toBeLessThan(115);
    expect(s.lossM!).toBeGreaterThan(90);
    expect(s.lossM!).toBeLessThan(115);
    expect(s.minEle!).toBeGreaterThan(197);
    expect(s.maxEle!).toBeLessThan(304);
  });
  it('profil altimétrique', () => {
    const p = profileOf((geometry as { coordinates: Position[] }).coordinates);
    expect(p).toHaveLength(201);
    expect(p[200].distKm).toBeCloseTo(4, 1);
  });
});

describe('lib/geo altitude', () => {
  it('gainLoss : bruit sous le seuil ignoré, vraie pente comptée', () => {
    expect(gainLoss([100, 100.4, 100, 100.4, 100]).gainM).toBe(0);
    // noisy GPS settings (smoothing 5 + 3 m threshold) still available
    expect(gainLoss([100, 101, 100, 101, 100, 101], { window: 5, thresholdM: 3 }).gainM).toBe(0);
    const r = gainLoss([0, 10, 20, 30, 40, 50, 40, 30, 20, 10, 0]);
    expect(r.gainM).toBeGreaterThan(20);
    expect(r.lossM).toBeGreaterThan(20);
  });
  it('gainLoss : petites bosses d’un profil IGN comptées (pas de lissage, seuil 1 m)', () => {
    const eles = [100, 102, 100, 102, 100, 102, 100, 102, 100]; // 4 bumps of 2 m
    expect(gainLoss(eles).gainM).toBe(8);
    expect(gainLoss(eles, { window: 5, thresholdM: 3 }).gainM).toBeLessThan(4);
  });
  it('altitude manquante → statistiques nulles', () => {
    expect(elevationStats([[[6, 43], [6.1, 43.1]]])).toEqual({ gainM: null, lossM: null, minEle: null, maxEle: null });
  });
});

describe('lib/geo bbox / boucle', () => {
  const multi: TrackGeometry = { type: 'MultiLineString', coordinates: [[[6, 43], [6.2, 43.1]], [[5.9, 43.3], [6, 43.2]]] };
  it('bbox d’un MultiLineString', () => {
    expect(bboxOf(multi)).toEqual({ minLon: 5.9, minLat: 43, maxLon: 6.2, maxLat: 43.3 });
    expect(bboxOf({ type: 'LineString', coordinates: [] })).toBeNull();
  });
  it('départ et non-boucle', () => {
    expect(startOf(multi)).toEqual([6, 43]);
    expect(isLoop(multi)).toBe(false);
  });
});

describe('lib/geo Douglas-Peucker', () => {
  it('supprime les points alignés et garde les extrémités et les sommets', () => {
    const line: Position[] = [[6, 43], [6.001, 43], [6.002, 43], [6.002, 43.002]];
    const s = simplifyLine(line, 5);
    expect(s).toEqual([[6, 43], [6.002, 43], [6.002, 43.002]]);
  });
  it('tolérance large → extrémités seules', () => {
    const line: Position[] = [[6, 43], [6.001, 43.0001], [6.002, 43]];
    expect(simplifyLine(line, 1000)).toEqual([[6, 43], [6.002, 43]]);
  });
});

describe('enrichElevation (IGN)', () => {
  const g: TrackGeometry = { type: 'LineString', coordinates: [[6, 43], [6.001, 43.001], [6.002, 43.002]] };
  it('complète les altitudes avec des appels groupés puis utilise le cache', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const n = new URL(url).searchParams.get('lon')!.split('|').length;
      return { ok: true, status: 200, json: async () => ({ elevations: Array.from({ length: n }, (_, i) => 100 + i) }) };
    });
    const cache = new Map<string, number>();
    const out = await enrichElevation(g, { fetchFn, cache, intervalMs: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(out.coordinates.map((p) => p[2])).toEqual([100, 101, 102]);
    await enrichElevation(g, { fetchFn, cache, intervalMs: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('ne fait aucun appel si les altitudes sont là', async () => {
    const fetchFn = vi.fn();
    const full: TrackGeometry = { type: 'LineString', coordinates: [[6, 43, 1], [6, 43.1, 2]] };
    expect(await enrichElevation(full, { fetchFn })).toBe(full);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('mode replace (#1515) : toutes les altitudes viennent de l’IGN, repli sur la source hors couverture ou en panne', async () => {
    const withGps: TrackGeometry = { type: 'LineString', coordinates: [[6, 43, 1], [6.001, 43.001, 2], [6.002, 43.002, 3]] };
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ elevations: [100, -99999, 102] }) });
    const out = await enrichElevation(withGps, { fetchFn, cache: new Map(), intervalMs: 0, replace: true });
    expect(out.coordinates.map((p) => p[2])).toEqual([100, 2, 102]);
    const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
    expect(await enrichElevation(withGps, { fetchFn: down, cache: new Map(), intervalMs: 0, replace: true })).toBe(withGps);
    await expect(enrichElevation(g, { fetchFn: down, cache: new Map(), intervalMs: 0, replace: true })).rejects.toThrow('503');
  });
  it('mode replace : source ign désactivée → géométrie inchangée, aucun appel', async () => {
    const prev = config.dataSources;
    config.dataSources = new Set(['osm']);
    try {
      const withGps: TrackGeometry = { type: 'LineString', coordinates: [[6, 43, 1], [6.001, 43.001, 2]] };
      expect(await enrichElevation(withGps, { replace: true })).toBe(withGps);
    } finally {
      config.dataSources = prev;
    }
  });
  it('erreur HTTP remontée', async () => {
    const fetchFn = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await expect(enrichElevation(g, { fetchFn, cache: new Map(), intervalMs: 0 })).rejects.toThrow('429');
  });
});
