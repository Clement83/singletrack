import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '@/db';
import { track } from '@/db/schema';
import { geotrekSource, trekToTrack, htmlToText, slugify, SPORT_NATURE_VAR, type GeotrekTrek } from '@/lib/geotrek';
import { geometryLength } from '@/lib/geo';
import { syncSource } from '@/lib/tracks';

const fx = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/geotrek', f), 'utf8'));
const region = { code: '83', center: { lat: 43.2, lon: 6.1 }, bbox: { minLon: 5.7, minLat: 42.9, maxLon: 7, maxLat: 43.8 } };

function fakeFetch(calls: string[] = []): typeof fetch {
  return (async (url: string) => {
    calls.push(url);
    const body = url.includes('trek_difficulty') ? fx('difficulties.json') : fx('treks-vtt.json');
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('Geotrek Sport Nature Var (réponses API enregistrées)', () => {
  it('htmlToText / slugify', () => {
    expect(htmlToText('<p dir="ltr"><span>Bonjour &amp; l&rsquo;été&nbsp;!</span></p>')).toContain('Bonjour & l');
    expect(htmlToText('')).toBeNull();
    expect(slugify('Le Pierrier du lac')).toBe('Le-Pierrier-du-lac');
    expect(slugify('La Bresque à vélo')).toBe('La-Bresque-a-velo');
  });

  it('produit les 8 circuits avec attribution et lien officiel', async () => {
    const calls: string[] = [];
    const out = [];
    for await (const t of geotrekSource({ fetchImpl: fakeFetch(calls) }).sync(region)) out.push(t);
    expect(out).toHaveLength(8);
    expect(calls.some((c) => c.includes('practices=2'))).toBe(true);
    for (const t of out) {
      expect(t.source).toBe('geotrek');
      expect(t.externalId).toMatch(/^var\/\d+$/);
      expect(t.attribution).toBe('Source : Département du Var – Sport Nature Var');
      expect(t.sourceUrl).toMatch(/^https:\/\/sportnature\.var\.fr\/trek\/\d+-/);
      expect(geometryLength(t.geometry)).toBeGreaterThan(5000);
    }
    const bresque = out.find((t) => t.externalId === 'var/11973')!;
    expect(bresque.difficulty).toBe('red'); // Difficile
    expect(bresque.difficultyRaw).toBe('Difficile (3)');
    expect(out.find((t) => t.externalId === 'var/13389')!.difficulty).toBe('blue'); // Moyen
    expect((bresque.raw as { official: boolean }).official).toBe(true);
  });

  it('ignore un circuit non publié ou sans géométrie', () => {
    const base = fx('treks-vtt.json').results[0] as GeotrekTrek;
    const labels = new Map([[3, 'Difficile']]);
    expect(trekToTrack(SPORT_NATURE_VAR, { ...base, published: false }, labels)).toBeNull();
    expect(trekToTrack(SPORT_NATURE_VAR, { ...base, geometry: null }, labels)).toBeNull();
  });

  it('synchro idempotente en base', async () => {
    const { db } = openDb(':memory:');
    const src = geotrekSource({ fetchImpl: fakeFetch() });
    const r1 = await syncSource(db, src, region, { enrich: false });
    expect(r1.created).toBe(8);
    const slugs = db.select().from(track).all().map((r) => r.slug).sort();
    const r2 = await syncSource(db, src, region, { enrich: false });
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(8);
    expect(db.select().from(track).all().map((r) => r.slug).sort()).toEqual(slugs);
  });
});
