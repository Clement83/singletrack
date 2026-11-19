import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { friendship, track, user } from '@/db/schema';
import { pairKey } from '@/lib/friends';
import { canViewTrack, createEditedTrack, getVisibleTrack, parseFilters, queryTracks, trackVisibleSql, upsertTrack } from '@/lib/tracks';
import { getDefaultTrackVisibility, setDefaultTrackVisibility } from '@/lib/user-profile';
import type { Position } from '@/lib/geo';

// Track visibility (#1588): a single rule, function version and SQL version on the same case table.
const NO_IGN = { enrich: false } as const;
const coords: Position[] = Array.from({ length: 30 }, (_, i) => [6.14 + i * 0.001, 43.22 + (i % 3) * 0.0005, 100 + i * 2] as Position);
const geometry = { type: 'LineString' as const, coordinates: coords };

function setup() {
  const { db } = openDb(':memory:');
  const now = new Date();
  for (const id of ['author', 'friend', 'other']) db.insert(user).values({ id, name: id, email: `${id}@x.fr`, emailVerified: true, createdAt: now, updatedAt: now }).run();
  db.insert(friendship).values({ requesterId: 'author', addresseeId: 'friend', pairKey: pairKey('author', 'friend'), status: 'accepted' }).run();
  // Pending request: not a friend.
  db.insert(friendship).values({ requesterId: 'other', addresseeId: 'author', pairKey: pairKey('other', 'author'), status: 'pending' }).run();
  return db;
}

const VIEWERS = ['anon', 'author', 'friend', 'other'] as const;
// [status, visibility] → who sees it
const CASES: [string, string, Record<(typeof VIEWERS)[number], boolean>][] = [
  ['published', 'public', { anon: true, author: true, friend: true, other: true }],
  ['published', 'friends', { anon: false, author: true, friend: true, other: false }],
  ['published', 'private', { anon: false, author: true, friend: false, other: false }],
  ['draft', 'public', { anon: false, author: true, friend: false, other: false }],
  ['draft', 'friends', { anon: false, author: true, friend: false, other: false }],
  ['draft', 'private', { anon: false, author: true, friend: false, other: false }],
];

describe('visibilité des traces (#1588)', () => {
  for (const [status, visibility, expected] of CASES) {
    it(`${status} / ${visibility} : fonction et SQL donnent le même résultat`, async () => {
      const db = setup();
      const r = await upsertTrack(db, { source: 'gpx', externalId: null, name: 'T', geometry, raw: null, createdBy: 'author', status: status as 'draft' | 'published', visibility: visibility as 'public' }, NO_IGN);
      const t = db.select().from(track).where(eq(track.slug, r.slug)).get()!;
      expect(t.visibility).toBe(visibility);
      for (const v of VIEWERS) {
        const uid = v === 'anon' ? null : v;
        expect(canViewTrack(db, t, uid), `fn ${v}`).toBe(expected[v]);
        expect(!!getVisibleTrack(db, r.slug, uid), `getVisibleTrack ${v}`).toBe(expected[v]);
        // SQL: drafts are filtered separately (status), then visibility.
        const sqlRows = db.select({ id: track.id }).from(track).where(and(eq(track.status, 'published'), trackVisibleSql(uid))).all();
        expect(sqlRows.length === 1, `sql ${v}`).toBe(status === 'published' && expected[v]);
        const listed = queryTracks(db, parseFilters(new URLSearchParams()), undefined, { userId: uid ?? undefined }).tracks;
        expect(listed.length === 1, `queryTracks ${v}`).toBe(status === 'published' && expected[v]);
      }
    });
  }

  it('une trace existante sans valeur explicite est publique (défaut de la colonne)', async () => {
    const db = setup();
    const r = await upsertTrack(db, { source: 'gpx', externalId: null, name: 'T', geometry, raw: null, createdBy: 'author' }, NO_IGN);
    expect(db.select().from(track).where(eq(track.slug, r.slug)).get()!.visibility).toBe('public');
  });

  it('les sources synchronisées restent publiques, même si on demande autre chose', async () => {
    const db = setup();
    const r = await upsertTrack(db, { source: 'osm', externalId: 'r/1', name: 'O', geometry, raw: null, visibility: 'private' }, NO_IGN);
    expect(db.select().from(track).where(eq(track.slug, r.slug)).get()!.visibility).toBe('public');
    await upsertTrack(db, { source: 'geotrek', externalId: 'g/1', name: 'G', geometry, raw: null }, NO_IGN);
    db.update(track).set({ visibility: 'private' }).where(eq(track.source, 'geotrek')).run();
    await upsertTrack(db, { source: 'geotrek', externalId: 'g/1', name: 'G', geometry, raw: null }, NO_IGN);
    expect(db.select().from(track).where(eq(track.source, 'geotrek')).get()!.visibility).toBe('public');
  });

  it('préférences de compte : dessinée = publique, importée = privée par défaut ; la création les applique', async () => {
    const db = setup();
    expect(getDefaultTrackVisibility(db, 'author', 'drawn')).toBe('public');
    expect(getDefaultTrackVisibility(db, 'author', 'imported')).toBe('private');
    expect(setDefaultTrackVisibility(db, 'author', 'drawn', 'nope')).toEqual({ ok: false, error: 'invalid' });
    expect(setDefaultTrackVisibility(db, 'author', 'drawn', 'friends')).toEqual({ ok: true });
    expect(getDefaultTrackVisibility(db, 'author', 'drawn')).toBe('friends');
    const input = { name: 'Ma boucle', geometry, waypoints: [[6.14, 43.22], [6.17, 43.22]], modes: ['route'] };
    const a = await createEditedTrack(db, 'author', input, NO_IGN);
    const b = await createEditedTrack(db, 'author', { ...input, visibility: 'private' }, NO_IGN);
    if (!('slug' in a) || !('slug' in b)) throw new Error('refusé');
    expect(db.select().from(track).where(eq(track.slug, a.slug)).get()!.visibility).toBe('friends');
    expect(db.select().from(track).where(eq(track.slug, b.slug)).get()!.visibility).toBe('private');
  });
});
