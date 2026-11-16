import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { outing } from '@/db/schema';
import { createEditedTrack, deleteTrack, getTrackBySlug, upsertTrack, type EditorInput } from '@/lib/tracks';
import { createOuting, refreshSnapshot } from '@/lib/outings/service';
import type { Position } from '@/lib/geo';

function setup() {
  const { db, sqlite } = openDb(':memory:');
  for (const id of ['u', 'v']) sqlite.prepare("insert into user (id,name,email,email_verified,created_at,updated_at) values (?,?,?,1,0,0)").run(id, id, `${id}@x.fr`);
  return db;
}
const coords: Position[] = Array.from({ length: 30 }, (_, i) => [6.14 + i * 0.001, 43.22 + (i % 3) * 0.0005, 100 + i * 2] as Position);
const input = (over: Partial<EditorInput> = {}): EditorInput => ({
  name: 'Ma boucle', description: '', geometry: { type: 'LineString', coordinates: coords },
  waypoints: [[6.14, 43.22], [6.17, 43.22]], modes: ['route'], ...over,
});
const NO_IGN = { enrich: false } as const;
const slugOf = (r: unknown) => (r as { slug: string }).slug;

describe('suppression d’une trace (#1449)', () => {
  it('l’auteur supprime sa trace : 404 ensuite', async () => {
    const db = setup();
    const s = slugOf(await createEditedTrack(db, 'u', input(), NO_IGN));
    expect(deleteTrack(db, 'u', s)).toEqual({ ok: true });
    expect(getTrackBySlug(db, s)).toBeUndefined();
    expect(deleteTrack(db, 'u', s)).toEqual({ error: 'not_found' });
  });

  it('refuse un autre utilisateur et les sources externes', async () => {
    const db = setup();
    const s = slugOf(await createEditedTrack(db, 'u', input(), NO_IGN));
    expect(deleteTrack(db, 'v', s)).toEqual({ error: 'forbidden' });
    const osm = await upsertTrack(db, { source: 'osm', externalId: 'relation/1', name: 'OSM', geometry: { type: 'LineString', coordinates: coords }, createdBy: 'u' }, NO_IGN);
    expect(deleteTrack(db, 'u', osm.slug)).toEqual({ error: 'forbidden' });
    expect(getTrackBySlug(db, osm.slug)).toBeDefined();
  });

  it('détache les copies et garde les sorties (snapshot)', async () => {
    const db = setup();
    const s = slugOf(await createEditedTrack(db, 'u', input(), NO_IGN));
    const copy = slugOf(await createEditedTrack(db, 'u', input({ parentSlug: s, name: 'Copie' }), NO_IGN));
    const o = await createOuting(db, 'u', { trackSlug: s, title: 'Sortie', date: '2099-05-10', time: '08:30' });
    if (!('slug' in o)) throw new Error(JSON.stringify(o));
    expect(deleteTrack(db, 'u', s)).toEqual({ ok: true });
    expect(getTrackBySlug(db, copy)!.parentTrackId).toBeNull();
    const row = db.select().from(outing).where(eq(outing.slug, o.slug)).get()!;
    expect(row.trackId).toBeNull();
    expect(row.trackSnapshot).toBeTruthy();
    expect(refreshSnapshot(db, 'u', o.slug)).toMatchObject({ ok: false });
  });
});
