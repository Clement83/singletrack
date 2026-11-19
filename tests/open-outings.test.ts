import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { friendship, invitation, outing, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { createOuting, listVisibleOutings } from '@/lib/outings';

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
    // These tests cover "public" outings that still have an owner (before #1455): it is given back to them.
    db.update(outing).set({ ownerId: owner }).where(eq(outing.slug, r.slug)).run();
    return db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
  };
  const friend = (x: string, y: string, status: 'pending' | 'accepted') =>
    db.insert(friendship).values({ requesterId: x, addresseeId: y, pairKey: [x, y].sort().join(':'), status }).run();
  return { db, mk, friend };
}

describe('sorties ouvertes (#1443)', () => {
  it('visibilité croisée : copain / en attente / inconnu × 3 niveaux', async () => {
    const { db, mk, friend } = await setup();
    friend('a', 'b', 'accepted'); friend('a', 'c', 'pending');
    await mk('a', { visibility: 'public', title: 'P' });
    await mk('a', { visibility: 'friends', title: 'F' });
    await mk('a', { visibility: 'invite', title: 'I' });
    const titles = (v: string) => listVisibleOutings(db, v).map((o) => o.title).sort();
    expect(titles('b')).toEqual(['F', 'P']);
    expect(titles('c')).toEqual(['P']);
    expect(titles('d')).toEqual(['P']);
    expect(titles('a')).toEqual([]); // ses propres sorties
  });

  it('exclut passées, annulées, déjà rejointes ; compte les « je viens » et les places', async () => {
    const { db, mk } = await setup();
    await mk('a', { visibility: 'public', title: 'passée', date: '2020-01-01' });
    const cancelled = await mk('a', { visibility: 'public', title: 'annulée' });
    db.update(outing).set({ status: 'cancelled' }).where(eq(outing.id, cancelled.id)).run();
    const joined = await mk('a', { visibility: 'public', title: 'rejointe' });
    const full = await mk('a', { visibility: 'public', title: 'pleine', maxParticipants: 1 });
    const inv = (o: typeof full, extra: object) => db.insert(invitation).values({ outingId: o.id, tokenHash: crypto.randomUUID(), name: 'Secret', ...extra }).run();
    inv(joined, { userId: 'b', status: 'yes' });
    inv(full, { status: 'yes' });
    inv(full, { status: 'yes', revokedAt: new Date() });
    const list = listVisibleOutings(db, 'b');
    expect(list.map((o) => o.title)).toEqual(['pleine']);
    expect(list[0]).toMatchObject({ yesCount: 1, spotsLeft: 0, organizerName: 'A', visibility: 'public' });
  });

  it('tri par date et champs exposés limités', async () => {
    const { db, mk } = await setup();
    await mk('a', { visibility: 'public', title: 'tard', date: '2099-06-01' });
    await mk('a', { visibility: 'public', title: 'tôt', date: '2099-05-01' });
    const list = listVisibleOutings(db, 'd');
    expect(list.map((o) => o.title)).toEqual(['tôt', 'tard']);
    const json = JSON.stringify(list);
    for (const banned of ['slug', 'openToken', 'tokenHash', 'email', '@x.fr', 'Secret']) expect(json).not.toContain(banned);
    expect(list[0].spotsLeft).toBeNull();
  });
});
