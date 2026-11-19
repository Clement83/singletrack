import { describe, it, expect } from 'vitest';
import { openDb } from '@/db';
import { upsertTrack, parseFilters, serializeFilters, queryTracks, estimateDurationMin, activeFilterCount, type NormalizedTrack } from '@/lib/tracks';
import { toGpx, parseGpx } from '@/lib/geo';

const home = { lat: 43.2269, lon: 6.1469 };

/** Loop of about `km` km around (lat, lon), with some relief. */
function loopTrack(id: string, name: string, lat: number, lon: number, km: number, over: Partial<NormalizedTrack> = {}): NormalizedTrack {
  const n = 200;
  const r = km / (2 * Math.PI) / 111;
  const coords = Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return [lon + (r * Math.cos(a)) / Math.cos((lat * Math.PI) / 180), lat + r * Math.sin(a), 100 + 80 * (1 - Math.cos(a))] as [number, number, number];
  });
  return { source: 'osm', externalId: id, name, geometry: { type: 'LineString', coordinates: coords }, ...over };
}

async function seed() {
  const { db, sqlite } = openDb(':memory:');
  await upsertTrack(db, loopTrack('a', 'Boucle du Fenouillet', 43.23, 6.15, 12, { difficulty: 'green' }), { enrich: false });
  await upsertTrack(db, loopTrack('b', 'Grande balade Sainte-Baume', 43.3, 5.7, 40, { difficulty: 'red', source: 'gpx' }), { enrich: false });
  await upsertTrack(db, loopTrack('c', 'Crêtes noires', 43.4, 6.5, 25, { difficulty: 'black' }), { enrich: false });
  return { db, sqlite };
}

describe('filtres dans l’URL', () => {
  it('aller-retour parse/serialize et valeurs invalides ignorées', () => {
    const sp = new URLSearchParams('q=baume&minKm=10&maxKm=abc&difficulty=red,pink&shape=loop&source=osm,xx&near=20&bbox=1,2,3,4');
    const f = parseFilters(sp);
    expect(f).toEqual({ q: 'baume', minKm: 10, difficulty: ['red'], shape: 'loop', near: 20, bbox: [1, 2, 3, 4] });
    expect(parseFilters(serializeFilters(f))).toEqual(f);
    expect(activeFilterCount(f)).toBe(5);
    expect(serializeFilters({}).toString()).toBe('');
  });
});

describe('queryTracks', () => {
  it('filtre par distance, difficulté, texte, rayon et bbox', async () => {
    const { db, sqlite } = await seed();
    const names = (f: Parameters<typeof queryTracks>[1]) => queryTracks(db, f, home).tracks.map((t) => t.name).sort();
    expect(names({})).toHaveLength(3);
    expect(names({ minKm: 20 })).toEqual(['Crêtes noires', 'Grande balade Sainte-Baume']);
    expect(names({ maxKm: 15 })).toEqual(['Boucle du Fenouillet']);
    expect(names({ difficulty: ['red', 'black'] })).toHaveLength(2);
    expect(names({ q: 'BAUME' })).toEqual(['Grande balade Sainte-Baume']);
    expect(names({ shape: 'oneway' })).toEqual([]);
    expect(names({ shape: 'loop' })).toHaveLength(3);
    expect(names({ near: 20 })).toEqual(['Boucle du Fenouillet']);
    expect(names({ bbox: [6.4, 43.3, 6.6, 43.5] })).toEqual(['Crêtes noires']);
    expect(names({ minGain: 100000 })).toEqual([]);
    sqlite.close();
  });

  it('sert une géométrie simplifiée, plus légère que la trace complète', async () => {
    const { db, sqlite } = await seed();
    const [t] = queryTracks(db, { q: 'fenouillet' }).tracks;
    expect(t.geometry!.type).toBe('LineString');
    expect((t.geometry as { coordinates: unknown[] }).coordinates.length).toBeLessThan(201);
    expect(t.slug).toMatch(/^[0-9a-f-]{36}$/);
    sqlite.close();
  });
});

describe('durée estimée et GPX', () => {
  it('12 km/h à plat + 400 m de D+ par heure', () => {
    expect(estimateDurationMin(24000, 0)).toBe(120);
    expect(estimateDurationMin(24000, 400)).toBe(180);
    expect(estimateDurationMin(12000, null)).toBe(60);
  });
  it('toGpx est relisible par parseGpx et échappe le XML', () => {
    const geometry = { type: 'LineString' as const, coordinates: [[6.1, 43.2, 100], [6.2, 43.3, 120]] as [number, number, number][] };
    const xml = toGpx({ name: 'A & B <1>', attribution: '© OSM', geometry });
    expect(xml).toContain('A &amp; B &lt;1&gt;');
    const back = parseGpx(xml);
    expect(back.geometry).toEqual(geometry);
  });
});

describe('performance avec toutes les traces du Var', () => {
  it('500 traces de 1 500 points : requête + géométrie simplifiée', async () => {
    const { db, sqlite } = openDb(':memory:');
    for (let i = 0; i < 500; i++) {
      const t = loopTrack(`p${i}`, `Trace ${i}`, 43.0 + (i % 25) * 0.03, 5.8 + Math.floor(i / 25) * 0.05, 8 + (i % 40), {});
      const c = (t.geometry as { coordinates: [number, number, number][] }).coordinates;
      // 1,500 points: the 200-point loop is densified.
      const dense: [number, number, number][] = Array.from({ length: 1500 }, (_, k) => c[Math.floor((k / 1500) * (c.length - 1))]);
      await upsertTrack(db, { ...t, geometry: { type: 'LineString', coordinates: dense } }, { enrich: false });
    }
    const t0 = performance.now();
    const first = queryTracks(db, {}, undefined, { limit: 1000 }).tracks;
    const cold = performance.now() - t0;
    const t1 = performance.now();
    const filtered = queryTracks(db, { minKm: 20, difficulty: undefined, bbox: [5.8, 43.0, 6.5, 43.5] }).tracks;
    const warm = performance.now() - t1;
    const bytes = JSON.stringify(first).length;
    console.log(`[perf] ${first.length} traces : 1re requête ${cold.toFixed(0)} ms, filtrée ${warm.toFixed(0)} ms (${filtered.length} résultats), JSON ${(bytes / 1024).toFixed(0)} Ko`);
    expect(first).toHaveLength(500);
    expect(cold).toBeLessThan(5000);
    sqlite.close();
  }, 60000);
});
