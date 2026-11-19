import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { track, trailSegment } from '@/db/schema';
import { FR_DEPARTMENTS, inVar, normalizeZone, parseZones, buildQuery, buildSinglesQuery, wayToSegment, type OverpassWay } from '@/lib/osm';
import { replaceSegments, querySegments } from '@/lib/osm/singles-store';
import { GEOTREK_INSTANCES, parseInstances } from '@/lib/geotrek';
import { upsertTrack, queryTracks, ensureTrackElevation, type NormalizedTrack } from '@/lib/tracks';
import { previewConditions } from '@/lib/conditions-preview';

describe('zones OSM : départements de France (#1428)', () => {
  it('96 départements métropolitains, Corse comprise, sans doublon', () => {
    expect(FR_DEPARTMENTS).toHaveLength(96);
    expect(new Set(FR_DEPARTMENTS).size).toBe(96);
    expect(FR_DEPARTMENTS).toContain('2A');
    expect(FR_DEPARTMENTS).toContain('83');
    expect(FR_DEPARTMENTS).not.toContain('20');
    expect(FR_DEPARTMENTS).not.toContain('971');
  });
  it('arguments de ligne de commande', () => {
    expect(normalizeZone('6')).toBe('06');
    expect(normalizeZone('2a')).toBe('2A');
    expect(normalizeZone('99')).toBeNull();
    expect(parseZones([]).zones).toHaveLength(96);
    expect(parseZones(['83,6', '2a', '83', 'xx'])).toEqual({ zones: ['83', '06', '2A'], invalid: ['xx'] });
    expect(parseZones(['--', 'all']).zones).toHaveLength(96);
  });
  it('requêtes Overpass : une zone par requête', () => {
    expect(buildQuery('06')).toContain('"ref:INSEE"="06"');
    expect(buildSinglesQuery('2A')).toContain('"ref:INSEE"="2A"');
  });
  it('inVar : Pierrefeu oui, Chamonix et Nice non', () => {
    expect(inVar(6.1469, 43.2269)).toBe(true);
    expect(inVar(6.87, 45.92)).toBe(false);
    expect(inVar(7.27, 43.7)).toBe(false);
  });
});

describe('instances Geotrek (#1428)', () => {
  it('ids uniques, API v2, attribution propre à chaque instance', () => {
    const ids = GEOTREK_INSTANCES.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['var', 'ecrins']));
    for (const i of GEOTREK_INSTANCES) {
      expect(i.apiBase).toMatch(/^https:\/\/.+\/api\/v2$/);
      expect(i.attribution).toMatch(/^Source : /);
      expect(i.practices.length).toBeGreaterThan(0);
    }
    expect(new Set(GEOTREK_INSTANCES.map((i) => i.attribution)).size).toBe(ids.length);
  });
  it('sélection par id', () => {
    expect(parseInstances([]).instances).toHaveLength(GEOTREK_INSTANCES.length);
    expect(parseInstances(['ecrins', 'zz'])).toMatchObject({ invalid: ['zz'] });
    expect(parseInstances(['ecrins']).instances.map((i) => i.id)).toEqual(['ecrins']);
  });
});

const way = (id: number, lon: number, lat: number): OverpassWay => ({
  type: 'way', id, tags: { highway: 'path', 'mtb:scale': '1' }, geometry: [{ lon, lat }, { lon: lon + 0.001, lat: lat + 0.001 }],
});
const seg = (id: number, lon: number, lat: number) => wayToSegment(way(id, lon, lat))!;

describe('singles par zone et index R-tree (#1428)', () => {
  it('une synchro ne remplace que sa zone ; un way de bordure n’est jamais en double', () => {
    const { db } = openDb(':memory:');
    replaceSegments(db, [seg(1, 6.1, 43.2), seg(2, 6.2, 43.2)], new Date(), '83');
    replaceSegments(db, [seg(3, 7.2, 43.7), seg(2, 6.2, 43.2)], new Date(), '06'); // way 2 on the border
    expect(db.select().from(trailSegment).all().map((r) => r.osmId).sort()).toEqual(['way/1', 'way/2', 'way/3']);
    replaceSegments(db, [seg(1, 6.1, 43.2)], new Date(), '83'); // way 2 now belongs to 06: untouched
    expect(db.select().from(trailSegment).where(eq(trailSegment.zone, '06')).all().map((r) => r.osmId).sort()).toEqual(['way/2', 'way/3']);
    expect(db.select().from(trailSegment).all()).toHaveLength(3);
    replaceSegments(db, [], new Date(), '06');
    expect(db.select().from(trailSegment).all().map((r) => r.osmId)).toEqual(['way/1']);
  });

  it('le R-tree suit les insertions, mises à jour et suppressions', () => {
    const { db, sqlite } = openDb(':memory:');
    const count = () => (sqlite.prepare('select count(*) n from trail_segment_rtree').get() as { n: number }).n;
    replaceSegments(db, [seg(1, 6.1, 43.2), seg(2, 2.35, 48.85)], new Date(), '83');
    expect(count()).toBe(2);
    replaceSegments(db, [seg(1, 6.1, 43.2), seg(2, 2.35, 48.85)], new Date(), '83'); // upsert: no index duplicate
    expect(count()).toBe(2);
    replaceSegments(db, [seg(1, 6.5, 43.5)], new Date(), '83'); // way moved
    expect(count()).toBe(1);
    expect(querySegments(db, [6.4, 43.4, 6.6, 43.6], 13).features.map((f) => f.properties.id)).toEqual(['way/1']);
    expect(querySegments(db, [6.0, 43.1, 6.2, 43.3], 13).features).toEqual([]);
  });

  it('volume France : 20 000 segments, requête de vue en quelques ms', () => {
    const { db } = openDb(':memory:');
    const many = Array.from({ length: 20000 }, (_, i) => seg(10000 + i, -4 + (i % 200) * 0.05, 42 + Math.floor(i / 200) * 0.09));
    replaceSegments(db, many, new Date(), 'fr');
    const t0 = performance.now();
    const res = querySegments(db, [5.0, 43.0, 5.2, 43.2], 13);
    const ms = performance.now() - t0;
    console.log(`[perf] R-tree : ${many.length} segments, vue 0,2° → ${res.features.length} segments en ${ms.toFixed(1)} ms`);
    expect(res.status).toBe('ok');
    expect(res.features.length).toBeGreaterThan(0);
    expect(res.features.length).toBeLessThan(200);
    expect(ms).toBeLessThan(200);
  });
});

function line(id: string, lon: number, lat: number, withEle: boolean): NormalizedTrack {
  const coordinates = Array.from({ length: 30 }, (_, i) => (withEle ? [lon + i * 0.001, lat, 100 + i * 5] : [lon + i * 0.001, lat]) as [number, number, number?]);
  return { source: 'osm', externalId: id, name: `Trace ${id}`, geometry: { type: 'LineString', coordinates } as NormalizedTrack['geometry'] };
}

describe('explorateur à l’échelle de la France (#1428)', () => {
  it('plafonne par proximité du centre de la vue et annonce le total ; overview = sans géométrie', async () => {
    const { db } = openDb(':memory:');
    for (let i = 0; i < 30; i++) await upsertTrack(db, line(`r${i}`, 1 + i * 0.3, 44, true), { enrich: false });
    const f = { bbox: [0, 43, 12, 45] as [number, number, number, number] };
    const detail = queryTracks(db, f, undefined, { limit: 5 });
    expect(detail.total).toBe(30);
    expect(detail.tracks).toHaveLength(5);
    expect(detail.tracks.every((t) => t.geometry)).toBe(true);
    // the 5 closest to the centre (lon 6)
    const lons = detail.tracks.map((t) => t.start[0]);
    expect(Math.max(...lons) - Math.min(...lons)).toBeLessThan(2);
    const overview = queryTracks(db, f, undefined, { overview: true });
    expect(overview.tracks).toHaveLength(30);
    expect(overview.tracks.every((t) => t.geometry === null)).toBe(true);
  });

  it('D+ inconnu : jamais exclu à tort par un filtre de D+, affiché comme inconnu', async () => {
    const { db } = openDb(':memory:');
    await upsertTrack(db, line('noele', 6, 43.2, false), { enrich: false });
    await upsertTrack(db, line('ele', 6.5, 43.2, true), { enrich: false });
    const all = queryTracks(db, { minGain: 100000 }).tracks;
    expect(all.map((t) => t.name)).toEqual(['Trace noele']);
    expect(all[0].gainM).toBeNull();
    expect(queryTracks(db, { maxGain: 1 }).tracks.map((t) => t.name)).toEqual(['Trace noele']);
  });
});

describe('altitude à la demande (#1428)', () => {
  it('complète l’altitude à la première ouverture, l’enregistre, ne rappelle plus l’IGN', async () => {
    const { db } = openDb(':memory:');
    await upsertTrack(db, line('od', 6, 43.2, false), { enrich: false });
    const before = db.select().from(track).get()!;
    expect(before.minEle).toBeNull();
    expect(before.elevationGainM).toBeNull();
    let calls = 0;
    const fetchFn = async (url: string) => {
      calls++;
      const n = new URL(url).searchParams.get('lon')!.split('|').length;
      return { ok: true, status: 200, json: async () => ({ elevations: Array.from({ length: n }, (_, i) => 100 + i * 20) }) };
    };
    const after = await ensureTrackElevation(db, before, { fetchFn, intervalMs: 0, cache: new Map() });
    expect(after.minEle).not.toBeNull();
    expect(after.elevationGainM).toBeGreaterThan(0);
    const stored = db.select().from(track).get()!;
    expect(stored.elevationGainM).toBe(after.elevationGainM);
    expect((stored.geometry as { coordinates: number[][] }).coordinates.every((p) => typeof p[2] === 'number')).toBe(true);
    const n = calls;
    await ensureTrackElevation(db, stored, { fetchFn, intervalMs: 0, cache: new Map() });
    expect(calls).toBe(n);
  });

  it('IGN en panne : la trace reste intacte (D+ inconnu), nouvel essai possible', async () => {
    const { db } = openDb(':memory:');
    await upsertTrack(db, line('down', 6, 43.2, false), { enrich: false });
    const t = db.select().from(track).get()!;
    const fetchFn = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const r = await ensureTrackElevation(db, t, { fetchFn, intervalMs: 0, cache: new Map() });
    expect(r.minEle).toBeNull();
    expect(db.select().from(track).get()!.minEle).toBeNull();
  });
});

describe('conditions hors du Var (#1428)', () => {
  it('la chasse reste inconnue hors du Var (le verdict n’en dépend pas)', async () => {
    const { db } = openDb(':memory:');
    const geometry = { type: 'LineString' as const, coordinates: [[6.87, 45.92], [6.88, 45.93]] as [number, number][] };
    const weather = { kind: 'unavailable' } as never;
    const r = await previewConditions(db, { geometry, distanceM: 5000, gainM: 300, startsAt: new Date('2026-10-17T07:00:00Z'), lat: 45.92, lon: 6.87 }, weather);
    expect(r.hunting).toBe('unknown');
    const v = await previewConditions(db, { geometry, distanceM: 5000, gainM: 300, startsAt: new Date('2026-10-17T07:00:00Z'), lat: 43.2269, lon: 6.1469 }, weather);
    expect(v.hunting).toBe('caution');
  });
});
