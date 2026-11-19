import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { friendship, invitation, outing, outingArchive, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { clusterOutings, createOuting, getOutingDiscovery, listMapOutings, newInviteToken, type MapBbox } from '@/lib/outings';

const BBOX: MapBbox = [5, 42, 7, 44];

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values(['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), email: `${id}@x.fr` }))).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 20] as [number, number, number]) }, raw: {},
  }, { enrich: false });
  const mk = async (owner: string, extra: object = {}) => {
    const r = await createOuting(db, owner, { trackSlug: t.slug, title: 'Sortie', date: '2099-05-10', time: '08:30', ...extra });
    if (!('slug' in r)) throw new Error('création');
    return db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
  };
  const friend = (x: string, y: string) =>
    db.insert(friendship).values({ requesterId: x, addresseeId: y, pairKey: [x, y].sort().join(':'), status: 'accepted' }).run();
  const invite = (o: { id: string }, userId: string, extra: object = {}) => {
    const { tokenHash, tokenEnc } = newInviteToken();
    db.insert(invitation).values({ outingId: o.id, tokenHash, tokenEnc, name: 'x', userId, ...extra }).run();
  };
  return { db, mk, friend, invite };
}

describe('sorties sur la carte (#1461)', () => {
  it('visibilité : publique, privée invité non répondu, privée non invité, copain', async () => {
    const { db, mk, friend, invite } = await setup();
    friend('a', 'b');
    await mk('a', { visibility: 'public', title: 'P' });
    await mk('a', { visibility: 'friends', title: 'F' });
    const inv = await mk('a', { visibility: 'invite', title: 'I' });
    invite(inv, 'c'); // linked guest without an answer
    const titles = (v: string) => listMapOutings(db, v, BBOX).map((o) => o.title).sort();
    expect(titles('b')).toEqual(['F', 'P']); // friend: not the invitation-only outing
    expect(titles('c')).toEqual(['I', 'P']); // guest who has not answered
    expect(titles('d')).toEqual(['P']); // inconnu
    expect(titles('a')).toEqual(['F', 'I', 'P']); // owner
  });

  it('exclut passées, annulées, masquées, hors emprise ; expose le décompte sans identité', async () => {
    const { db, mk } = await setup();
    await mk('a', { visibility: 'public', title: 'passée', date: '2020-01-01' });
    const c = await mk('a', { visibility: 'public', title: 'annulée' });
    db.update(outing).set({ status: 'cancelled' }).where(eq(outing.id, c.id)).run();
    const h = await mk('a', { visibility: 'public', title: 'masquée' });
    db.insert(outingArchive).values({ outingId: h.id, userId: 'b', archived: true, updatedAt: new Date() }).run();
    const ok = await mk('a', { visibility: 'public', title: 'ok' });
    db.insert(invitation).values({ outingId: ok.id, tokenHash: 'h1', name: 'Secret', status: 'yes' }).run();
    const list = listMapOutings(db, 'b', BBOX);
    expect(list.map((o) => o.title)).toEqual(['ok']);
    expect(list[0]).toMatchObject({ yesCount: 1, mine: false });
    expect(JSON.stringify(list)).not.toMatch(/Secret|slug|token/i);
    expect(listMapOutings(db, 'b', [0, 0, 1, 1])).toEqual([]);
  });

  it('fiche : redirection si rattaché, 404 si invisible, rejoignable sinon', async () => {
    const { db, mk, friend, invite } = await setup();
    friend('a', 'b');
    const f = await mk('a', { visibility: 'friends', title: 'F' });
    const p = await mk('a', { visibility: 'invite', title: 'I' });
    expect(getOutingDiscovery(db, 'a', f.id)).toMatchObject({ kind: 'redirect', path: `/s/${f.slug}` });
    expect(getOutingDiscovery(db, 'b', f.id)).toMatchObject({ kind: 'show', canJoin: true });
    // #1598: the route shown by OutingView never contains the slug of the original track.
    const shown = getOutingDiscovery(db, 'b', f.id);
    if (shown.kind !== 'show') throw new Error('show');
    expect(shown.outing.track.name).toBeTruthy();
    expect(Object.keys(shown.outing.track)).not.toContain('slug');
    expect(getOutingDiscovery(db, 'c', f.id).kind).toBe('notFound');
    expect(getOutingDiscovery(db, 'b', p.id).kind).toBe('notFound');
    invite(f, 'b');
    const r = getOutingDiscovery(db, 'b', f.id);
    expect(r.kind === 'redirect' && r.path.startsWith('/i/')).toBe(true);
  });
});

describe('regroupement', () => {
  const pts = [{ id: '1', lat: 43.2, lon: 6.1 }, { id: '2', lat: 43.201, lon: 6.101 }, { id: '3', lat: 44.5, lon: 2 }];
  it('regroupe de loin, sépare de près', () => {
    expect(clusterOutings(pts, 8).map((c) => c.items.length).sort()).toEqual([1, 2]);
    expect(clusterOutings(pts, 12)).toHaveLength(3);
  });
});
