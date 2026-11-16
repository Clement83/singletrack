import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { track } from '@/db/schema';
import { canEditInPlace, createEditedTrack, getTrackBySlug, storedFromRaw, updateEditedTrack, upsertTrack, validateEditorInput, type EditorInput } from '@/lib/tracks';
import type { Position } from '@/lib/geo';

function setup() {
  const { db, sqlite } = openDb(':memory:');
  for (const id of ['u', 'v']) sqlite.prepare("insert into user (id,name,email,email_verified,created_at,updated_at) values (?,?,?,1,0,0)").run(id, id, `${id}@x.fr`);
  return db;
}
const coords: Position[] = Array.from({ length: 30 }, (_, i) => [6.14 + i * 0.001, 43.22 + (i % 3) * 0.0005, 100 + i * 2] as Position);
const input = (over: Partial<EditorInput> = {}): EditorInput => ({
  name: 'Ma boucle',
  description: 'test',
  geometry: { type: 'LineString', coordinates: coords },
  waypoints: [[6.14, 43.22], [6.17, 43.22]],
  modes: ['route'],
  ...over,
});
const NO_IGN = { enrich: false } as const;

describe('enregistrement de l’éditeur', () => {
  it('crée une trace maison avec son document d’édition', async () => {
    const db = setup();
    const r = await createEditedTrack(db, 'u', input(), NO_IGN);
    if (!('slug' in r)) throw new Error('refusé');
    const t = getTrackBySlug(db, r.slug)!;
    expect(t).toMatchObject({ source: 'manual', createdBy: 'u', parentTrackId: null, name: 'Ma boucle', attribution: null });
    expect(t.distanceM).toBeGreaterThan(2000);
    expect(t.elevationGainM).not.toBeNull();
    expect(storedFromRaw(t.raw)).toEqual({ waypoints: [[6.14, 43.22], [6.17, 43.22]], modes: ['route'] });
    expect(canEditInPlace(t, 'u')).toBe(true);
    expect(canEditInPlace(t, 'v')).toBe(false);
  });

  it('une copie garde l’attribution de l’origine et laisse l’original intact', async () => {
    const db = setup();
    const o = await upsertTrack(db, {
      source: 'geotrek', externalId: 'g1', name: 'Circuit officiel', sourceUrl: 'https://x.fr/c', author: 'Département', license: 'Etalab',
      attribution: 'Source : Sport Nature Var', geometry: { type: 'LineString', coordinates: coords }, difficulty: 'blue',
    }, NO_IGN);
    const before = getTrackBySlug(db, o.slug)!;
    expect(canEditInPlace(before, 'u')).toBe(false);
    const r = await createEditedTrack(db, 'u', input({ name: 'Ma version', parentSlug: o.slug }), NO_IGN);
    if (!('slug' in r)) throw new Error('refusé');
    const copy = getTrackBySlug(db, r.slug)!;
    expect(r.slug).not.toBe(o.slug);
    expect(copy).toMatchObject({
      source: 'edited', parentTrackId: before.id, attribution: 'Source : Sport Nature Var', license: 'Etalab', author: 'Département',
      sourceUrl: 'https://x.fr/c', difficulty: 'blue', createdBy: 'u',
    });
    expect(getTrackBySlug(db, o.slug)).toEqual(before);
    expect(db.select().from(track).where(eq(track.parentTrackId, before.id)).all()).toHaveLength(1);
    const ghost = await createEditedTrack(db, 'u', input({ parentSlug: 'inconnu' }), NO_IGN);
    expect(ghost).toHaveProperty('errors.parent');
  });

  it('met à jour en place sa propre trace, jamais celle des autres ni une trace importée', async () => {
    const db = setup();
    const mine = await createEditedTrack(db, 'u', input(), NO_IGN);
    if (!('slug' in mine)) throw new Error('refusé');
    const longer = coords.concat([[6.18, 43.22, 160]]);
    const up = await updateEditedTrack(db, 'u', mine.slug, input({ name: 'Renommée', geometry: { type: 'LineString', coordinates: longer } }), NO_IGN);
    expect(up).toEqual({ slug: mine.slug });
    const t = getTrackBySlug(db, mine.slug)!;
    expect(t.name).toBe('Renommée');
    expect(t.distanceM).toBeGreaterThan(2500);
    expect(await updateEditedTrack(db, 'v', mine.slug, input(), NO_IGN)).toEqual({ error: 'forbidden' });
    expect(await updateEditedTrack(db, 'u', 'nope', input(), NO_IGN)).toEqual({ error: 'not_found' });
    const osm = await upsertTrack(db, { source: 'osm', externalId: 'relation/1', name: 'OSM', geometry: { type: 'LineString', coordinates: coords }, createdBy: 'u' }, NO_IGN);
    expect(await updateEditedTrack(db, 'u', osm.slug, input(), NO_IGN)).toEqual({ error: 'forbidden' });
  });

  it('refuse les entrées invalides', () => {
    expect(validateEditorInput(input({ name: ' ' }))).toHaveProperty('errors.name');
    expect(validateEditorInput(input({ geometry: { type: 'LineString', coordinates: [[6, 43], [6.0001, 43]] } }))).toHaveProperty('errors.geometry');
    expect(validateEditorInput(input({ geometry: { type: 'LineString', coordinates: [[6, 43], [999, 43]] } }))).toHaveProperty('errors.geometry');
    expect(validateEditorInput(input({ modes: [] }))).toHaveProperty('errors.waypoints');
    expect(validateEditorInput(input())).toHaveProperty('name', 'Ma boucle');
  });
});
