import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openDb } from '@/db';
import { trailSegment, track } from '@/db/schema';
import { buildSinglesQuery, fetchSingles, segmentsFromOverpass, toleranceForZoom, wayToSegment, SINGLES_MAX_FEATURES, type OverpassWay } from '@/lib/osm';
import { parseSegmentsQuery, querySegments, replaceSegments } from '@/lib/osm/singles-store';

// Real fixture: path/track ways with mtb:scale around Pierrefeu-du-Var (Overpass, bbox 43.18,6.10,43.24,6.20).
const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/osm/singles-pierrefeu.json'), 'utf8')) as { elements: OverpassWay[] };

const way = (id: number, tags: Record<string, string>, pts: [number, number][]): OverpassWay => ({
  type: 'way',
  id,
  tags,
  geometry: pts.map(([lon, lat]) => ({ lon, lat })),
});

describe('singles OSM : logique pure (#1372)', () => {
  it('requête : ways path/track avec mtb:scale de la zone INSEE, un seul appel', () => {
    const q = buildSinglesQuery('83');
    expect(q).toContain('"ref:INSEE"="83"');
    expect(q).toContain('way(area.a)["highway"~"^(path|track)$"]["mtb:scale"]');
    expect(q).toContain('out geom;');
    expect(buildSinglesQuery('83"];evil')).toContain('"ref:INSEE"="83"');
  });

  it('way → segment : difficulté depuis mtb:scale, géométrie [lon, lat], longueur', () => {
    const s = wayToSegment(way(42, { highway: 'path', 'mtb:scale': '2+', name: ' Single du Fenouillet ' }, [[6.1, 43.2], [6.101, 43.2], [6.102, 43.201]]))!;
    expect(s.osmId).toBe('way/42');
    expect(s.difficulty).toBe('red');
    expect(s.mtbScale).toBe('2+');
    expect(s.name).toBe('Single du Fenouillet');
    expect(s.geometry.type).toBe('LineString');
    expect(s.bbox.minLon).toBeCloseTo(6.1);
    expect(s.lengthM).toBeGreaterThan(150);
  });

  it('écarte ce qui n’est pas un single exploitable', () => {
    expect(wayToSegment(way(1, { highway: 'residential', 'mtb:scale': '0' }, [[6, 43], [6.01, 43]]))).toBeNull();
    expect(wayToSegment(way(2, { highway: 'path' }, [[6, 43], [6.01, 43]]))).toBeNull();
    expect(wayToSegment(way(3, { highway: 'track', 'mtb:scale': '1' }, [[6, 43]]))).toBeNull();
    // nodes outside the extraction area (null) ignored
    const w = way(4, { highway: 'track', 'mtb:scale': '1' }, [[6, 43], [6.01, 43]]);
    w.geometry!.push(null);
    expect(wayToSegment(w)?.geometry.coordinates).toHaveLength(2);
  });

  it('tolérance de simplification selon le zoom', () => {
    expect(toleranceForZoom(11)).toBeGreaterThan(toleranceForZoom(13));
    expect(toleranceForZoom(16)).toBe(0);
  });

  it('paramètres de la route : bbox + zoom valides seulement', () => {
    expect(parseSegmentsQuery(new URLSearchParams('bbox=6,43,6.2,43.3&zoom=12'))).toEqual({ bbox: [6, 43, 6.2, 43.3], zoom: 12 });
    expect(parseSegmentsQuery(new URLSearchParams('bbox=6,43,6.2&zoom=12'))).toBeNull();
    expect(parseSegmentsQuery(new URLSearchParams('bbox=6.2,43,6,43.3&zoom=12'))).toBeNull();
    expect(parseSegmentsQuery(new URLSearchParams('bbox=6,43,6.2,43.3'))).toBeNull();
  });

  it('fixture réelle Overpass : tous les ways deviennent des segments avec difficulté', () => {
    const segs = segmentsFromOverpass(fixture);
    expect(fixture.elements.length).toBeGreaterThan(0);
    expect(segs.length).toBe(fixture.elements.filter((e) => e.type === 'way' && (e.geometry?.filter(Boolean).length ?? 0) >= 2).length);
    expect(segs.every((s) => s.osmId.startsWith('way/') && s.geometry.coordinates.length >= 2)).toBe(true);
    expect(segs.some((s) => s.difficulty !== null)).toBe(true);
  });

  it('fetchSingles : un seul appel Overpass (User-Agent générique), réessai sur erreur', async () => {
    const calls: RequestInit[] = [];
    const ok = (async (_u: string, init: RequestInit) => {
      calls.push(init);
      return new Response(JSON.stringify(fixture), { status: 200 });
    }) as unknown as typeof fetch;
    const segs = await fetchSingles('83', { fetchImpl: ok, retries: 0 });
    expect(calls).toHaveLength(1);
    expect((calls[0].headers as Record<string, string>)['User-Agent']).toBe('singletrack-sync/1.0');
    expect(segs.length).toBeGreaterThan(0);
    let n = 0;
    const flaky = (async () => (++n === 1 ? new Response('busy', { status: 504 }) : new Response(JSON.stringify(fixture)))) as unknown as typeof fetch;
    await expect(fetchSingles('83', { fetchImpl: flaky, retries: 1, retryDelayMs: 1 })).resolves.not.toHaveLength(0);
    expect(n).toBe(2);
  });
});

describe('singles OSM : stockage et requête par bbox (#1372)', () => {
  const segs = [
    wayToSegment(way(1, { highway: 'path', 'mtb:scale': '0' }, [[6.1, 43.2], [6.11, 43.2]]))!,
    wayToSegment(way(2, { highway: 'path', 'mtb:scale': '3' }, [[6.5, 43.5], [6.52, 43.5]]))!,
    wayToSegment(way(3, { highway: 'track', 'mtb:scale': 'x' }, [[6.105, 43.19], [6.105, 43.21]]))!,
  ];

  it('remplacement en bloc idempotent, jamais dans la table track', () => {
    const { db } = openDb(':memory:');
    replaceSegments(db, segs);
    replaceSegments(db, segs);
    expect(db.select().from(trailSegment).all()).toHaveLength(3);
    replaceSegments(db, segs.slice(0, 1));
    expect(db.select().from(trailSegment).all().map((r) => r.osmId)).toEqual(['way/1']);
    expect(db.select().from(track).all()).toHaveLength(0);
  });

  it('bbox + zoom : segments qui croisent la vue, rien sous le zoom minimal', () => {
    const { db } = openDb(':memory:');
    replaceSegments(db, segs);
    const res = querySegments(db, [6.0, 43.1, 6.2, 43.3], 13);
    expect(res.status).toBe('ok');
    expect(res.features.map((f) => f.properties.id).sort()).toEqual(['way/1', 'way/3']);
    expect(res.features.find((f) => f.properties.id === 'way/3')?.properties.difficulty).toBe('none');
    expect(querySegments(db, [6.0, 43.1, 6.2, 43.3], 9)).toEqual({ status: 'zoom_in', features: [] });
  });

  it('volume plafonné : truncated quand la vue dépasse le maximum', () => {
    const { db } = openDb(':memory:');
    const many = Array.from({ length: SINGLES_MAX_FEATURES + 5 }, (_, i) =>
      wayToSegment(way(1000 + i, { highway: 'path', 'mtb:scale': '1' }, [[6.1 + i * 1e-5, 43.2], [6.1 + i * 1e-5, 43.201]]))!,
    );
    replaceSegments(db, many);
    const res = querySegments(db, [6.0, 43.1, 6.3, 43.3], 12);
    expect(res.status === 'ok' && res.truncated).toBe(true);
    expect(res.features).toHaveLength(SINGLES_MAX_FEATURES);
  });
});
