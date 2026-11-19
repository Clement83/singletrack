import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '@/db';
import { track } from '@/db/schema';
import { stitchWays, relationGeometry, relationToTrack, osmSource, buildQuery, type OverpassRelation } from '@/lib/osm';
import { geometryLength, type Position } from '@/lib/geo';
import { syncSource } from '@/lib/tracks';

const load = (id: number): OverpassRelation =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/osm', `relation-${id}.json`), 'utf8')).elements[0];

const region = { code: '83', center: { lat: 43.2, lon: 6.1 }, bbox: { minLon: 5.7, minLat: 42.9, maxLon: 7, maxLat: 43.8 } };
const P = (x: number, y = 0): Position => [x, y];

describe('stitchWays', () => {
  it('colle des ways dans le bon ordre', () => {
    const r = stitchWays([[P(0), P(1)], [P(1), P(2)], [P(2), P(3)]]);
    expect(r).toEqual([[P(0), P(1), P(2), P(3)]]);
  });
  it('retourne les ways inversés', () => {
    const r = stitchWays([[P(0), P(1)], [P(2), P(1)], [P(2), P(3)]]);
    expect(r).toEqual([[P(0), P(1), P(2), P(3)]]);
  });
  it('relie deux chaînes par un way posé après elles', () => {
    const r = stitchWays([[P(0), P(1)], [P(3), P(4)], [P(1), P(2), P(3)]]);
    expect(r).toEqual([[P(0), P(1), P(2), P(3), P(4)]]);
  });
  it('un trou donne plusieurs lignes', () => {
    const r = stitchWays([[P(0), P(1)], [P(10), P(11)], [P(1), P(2)]]);
    expect(r).toHaveLength(2);
    expect(r).toContainEqual([P(0), P(1), P(2)]);
    expect(r).toContainEqual([P(10), P(11)]);
  });
  it('ignore les ways dégénérés', () => {
    expect(stitchWays([[P(0)], []])).toEqual([]);
  });
  it('boucle fermée : reste une seule ligne', () => {
    const r = stitchWays([[P(0), P(1)], [P(1), P(2)], [P(2), P(0)]]);
    expect(r).toHaveLength(1);
    expect(r[0]).toHaveLength(4);
  });
});

describe('relations OSM réelles du Var (fixtures Overpass)', () => {
  it.each([5134006, 5129609, 6104447])('relation %i : géométrie continue et sans saut', (id) => {
    const rel = load(id);
    const g = relationGeometry(rel)!;
    expect(g).not.toBeNull();
    const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    const total = geometryLength(g);
    expect(total).toBeGreaterThan(1000);
    // No aberrant jump between two consecutive points of a stitched line (> 500 m).
    for (const l of lines) {
      for (let i = 1; i < l.length; i++) {
        const d = Math.hypot((l[i][0] - l[i - 1][0]) * 80000, (l[i][1] - l[i - 1][1]) * 111000);
        expect(d).toBeLessThan(500);
      }
    }
  });
  it('La Pichote (5 ways) se recolle en une seule boucle', () => {
    const g = relationGeometry(load(5134006))!;
    expect(g.type).toBe('LineString');
  });
  it('mappe les tags en trace normalisée', () => {
    const t = relationToTrack(load(6104447))!;
    expect(t.externalId).toBe('relation/6104447');
    expect(t.name).toBe('Parcours 257-01');
    expect(t.attribution).toBe('© OpenStreetMap contributors');
    expect(t.license).toBe('ODbL');
    expect(t.sourceUrl).toBe('https://www.openstreetmap.org/relation/6104447');
  });
  it('difficulté depuis mtb:scale', () => {
    const rel = { ...load(5134006), tags: { name: 'X', route: 'mtb', 'mtb:scale': '2' } };
    const t = relationToTrack(rel)!;
    expect(t.difficulty).toBe('red');
    expect(t.difficultyRaw).toBe('mtb:scale=2');
  });
  it('relation sans géométrie : ignorée', () => {
    expect(relationToTrack({ type: 'relation', id: 1, tags: { route: 'mtb' }, members: [] })).toBeNull();
  });
});

describe('source Overpass + synchro', () => {
  const body = { elements: [load(5134006), load(6104447), { type: 'relation', id: 2, members: [] }] };
  const fakeFetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it('la requête cible le département et les route=mtb', () => {
    const q = buildQuery('83');
    expect(q).toContain('"ref:INSEE"="83"');
    expect(q).toContain('["route"="mtb"]');
    expect(q).toContain('out geom');
  });

  it('importe, puis une relance ne crée aucun doublon', async () => {
    const { db } = openDb(':memory:');
    const src = osmSource({ fetchImpl: fakeFetch, retries: 0 });
    const a = await syncSource(db, src, region, { enrich: false });
    expect(a).toEqual({ created: 2, updated: 0, failed: 0 });
    const slugs = db.select({ s: track.slug }).from(track).all().map((r) => r.s).sort();
    const b = await syncSource(db, src, region, { enrich: false });
    expect(b).toEqual({ created: 0, updated: 2, failed: 0 });
    expect(db.select().from(track).all()).toHaveLength(2);
    expect(db.select({ s: track.slug }).from(track).all().map((r) => r.s).sort()).toEqual(slugs);
  });

  it('erreur HTTP : réessaie puis échoue', async () => {
    let calls = 0;
    const bad = (async () => (calls++, new Response('busy', { status: 429 }))) as unknown as typeof fetch;
    const src = osmSource({ fetchImpl: bad, retries: 1, retryDelayMs: 1 });
    await expect((async () => { for await (const _ of src.sync(region)) void _; })()).rejects.toThrow(/429/);
    expect(calls).toBe(2);
  });
});
