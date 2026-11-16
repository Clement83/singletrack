import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { track } from '@/db/schema';
import { upsertTrack, syncSource, difficultyFromMtbScale, difficultyFromLabel, type NormalizedTrack, type TrackSource } from '@/lib/tracks';

const region = { code: '83', center: { lat: 43.2269, lon: 6.1469 }, bbox: { minLon: 5.7, minLat: 42.9, maxLon: 7.0, maxLat: 43.8 } };

const mk = (externalId: string | null, name: string, lat = 43.2): NormalizedTrack => ({
  source: 'osm',
  externalId,
  name,
  license: 'ODbL',
  attribution: '© OpenStreetMap contributors',
  geometry: { type: 'LineString', coordinates: [[6.1, lat, 100], [6.11, lat + 0.01, 180], [6.1, lat, 101]] },
  raw: { id: externalId },
});

/** Source factice : émet une trace deux fois (même external_id) puis une autre. */
const fake: TrackSource = {
  id: 'osm',
  async *sync() {
    yield mk('r1', 'Boucle A');
    yield mk('r1', 'Boucle A (renommée)');
    yield mk('r2', 'Boucle B', 43.3);
  },
};

describe('upsert idempotent des traces', () => {
  it('un réimport met à jour sans doublon et garde id/slug', async () => {
    const { db, sqlite } = openDb(':memory:');
    const first = await upsertTrack(db, mk('r1', 'A'), { enrich: false });
    const again = await upsertTrack(db, mk('r1', 'A bis'), { enrich: false });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.id).toBe(first.id);
    expect(again.slug).toBe(first.slug);
    const rows = db.select().from(track).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('A bis');
    expect(rows[0].slug).not.toBe(rows[0].id);
    expect(rows[0].loop).toBe(true);
    expect(rows[0].attribution).toContain('OpenStreetMap');
    expect(rows[0].distanceM).toBeGreaterThan(2000);
    expect(rows[0].elevationGainM).not.toBeNull();
    sqlite.close();
  });

  it('syncSource avec une source factice : 2 traces, 1 mise à jour', async () => {
    const { db, sqlite } = openDb(':memory:');
    const r1 = await syncSource(db, fake, region, { enrich: false });
    expect(r1).toEqual({ created: 2, updated: 1, failed: 0 });
    const r2 = await syncSource(db, fake, region, { enrich: false });
    expect(r2).toEqual({ created: 0, updated: 3, failed: 0 });
    expect(db.select().from(track).all()).toHaveLength(2);
    sqlite.close();
  });

  it('traces maison sans external_id : toujours insérées ; (source, external_id) unique en base', async () => {
    const { db, sqlite } = openDb(':memory:');
    await upsertTrack(db, { ...mk(null, 'M1'), source: 'manual' }, { enrich: false });
    await upsertTrack(db, { ...mk(null, 'M2'), source: 'manual' }, { enrich: false });
    expect(db.select().from(track).all()).toHaveLength(2);
    await upsertTrack(db, mk('x', 'X'), { enrich: false });
    expect(() => sqlite.prepare("INSERT INTO track (id,slug,source,external_id,name,geometry,bbox_min_lon,bbox_min_lat,bbox_max_lon,bbox_max_lat,start_lon,start_lat,distance_m,loop,created_at,updated_at) VALUES ('z','zz','osm','x','d','{}',0,0,0,0,0,0,0,0,0,0)").run()).toThrow(/UNIQUE/);
    sqlite.close();
  });

  it('une trace en erreur n’arrête pas l’import', async () => {
    const { db, sqlite } = openDb(':memory:');
    const bad: TrackSource = {
      id: 'gpx',
      async *sync() {
        yield { ...mk('b', 'vide'), source: 'gpx', geometry: { type: 'LineString', coordinates: [] } };
        yield { ...mk('g', 'ok'), source: 'gpx' };
      },
    };
    const errors: unknown[] = [];
    const r = await syncSource(db, bad, region, { enrich: false }, (e) => errors.push(e));
    expect(r).toEqual({ created: 1, updated: 0, failed: 1 });
    expect(errors).toHaveLength(1);
    expect(db.select().from(track).where(eq(track.source, 'gpx')).all()).toHaveLength(1);
    sqlite.close();
  });
});

describe('échelle de difficulté commune', () => {
  it('mtb:scale OSM', () => {
    expect([0, 1, 2, 3, 6].map(difficultyFromMtbScale)).toEqual(['green', 'blue', 'red', 'black', 'black']);
    expect(difficultyFromMtbScale('1+')).toBe('blue');
    expect(difficultyFromMtbScale(undefined)).toBeNull();
    expect(difficultyFromMtbScale('abc')).toBeNull();
  });
  it('libellés', () => {
    expect(difficultyFromLabel('Très difficile')).toBe('black');
    expect(difficultyFromLabel('Difficile')).toBe('red');
    expect(difficultyFromLabel('Facile')).toBe('green');
    expect(difficultyFromLabel('Bleu')).toBe('blue');
    expect(difficultyFromLabel('???')).toBeNull();
  });
});
