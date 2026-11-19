import { describe, it, expect } from 'vitest';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { createContact, createOuting, inviteMany, setStatus } from '@/lib/outings';
import { linkContact, requestByEmail, respondToRequest, listFriends } from '@/lib/friends';
import { getProfile, getVisibility, setVisibility } from '@/lib/user-profile';
import { invitation } from '@/db/schema';
import { eq } from 'drizzle-orm';

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([
    { id: 'a', name: 'Alice', email: 'a@x.fr' }, { id: 'b', name: 'Bob', email: 'b@x.fr' }, { id: 'c', name: 'Cléo', email: 'c@x.fr' },
  ]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 20] as [number, number, number]) }, raw: {},
  }, { enrich: false });
  const mk = async (owner: string, date: string, title: string) => {
    const r = await createOuting(db, owner, { trackSlug: t.slug, title, date, time: '08:30' });
    if (!('slug' in r)) throw new Error('création');
    return r.slug;
  };
  return { db, mk };
}

describe('profil et stats (#1433)', () => {
  it('privé par défaut : 404 (null) pour un inconnu, visible de soi ; public : visible de tout connecté', async () => {
    const { db, mk } = await setup();
    await mk('a', '2020-05-10', 'Passée');
    expect(getVisibility(db, 'a')).toBe('private');
    expect(getProfile(db, 'b', 'a')).toBeNull();
    expect(getProfile(db, 'a', 'a')?.isSelf).toBe(true);
    expect(getProfile(db, 'b', 'inconnu')).toBeNull();
    expect(setVisibility(db, 'a', 'secret')).toEqual({ ok: false, error: 'invalid' });
    expect(setVisibility(db, 'a', 'public').ok).toBe(true);
    const p = getProfile(db, 'b', 'a')!;
    expect(p.name).toBe('Alice');
    expect(p.isFriend).toBe(false);
    expect(Object.keys(p)).not.toContain('email');
  });

  it('un copain accepté voit un profil privé ; un retrait le referme ; demande en attente = non', async () => {
    const { db } = await setup();
    requestByEmail(db, 'b', 'a@x.fr');
    expect(getProfile(db, 'b', 'a')).toBeNull();
    const inc = listFriends(db, 'a').incoming[0];
    respondToRequest(db, 'a', inc.id, 'accept');
    expect(getProfile(db, 'b', 'a')?.isFriend).toBe(true);
    expect(getProfile(db, 'c', 'a')).toBeNull();
  });

  it('stats = historique (terminées seulement), dernière sortie, et sorties partagées avec le visiteur', async () => {
    const { db, mk } = await setup();
    await mk('a', '2020-05-10', 'Vieille');
    const recent = await mk('a', '2020-06-10', 'Récente');
    await mk('a', '2099-01-01', 'Future');
    const annulee = await mk('a', '2020-07-10', 'Annulée');
    setStatus(db, 'a', annulee, 'cancelled');
    setVisibility(db, 'a', 'public');
    const p = getProfile(db, 'b', 'a')!;
    expect(p.totals.outings).toBe(2);
    expect(p.totals.distanceM).toBeGreaterThan(0);
    expect(p.rides.map((r) => r.title)).toEqual(['Récente', 'Vieille']);
    expect(p.totals.lastAt?.toISOString().slice(0, 10)).toBe('2020-06-10');
    expect(p.shared).toEqual([]);

    // Alice has a buddy linked to Bob's account and invites him: her outing is marked "with you" for Bob.
    requestByEmail(db, 'a', 'b@x.fr');
    respondToRequest(db, 'b', listFriends(db, 'b').incoming[0].id, 'accept');
    const c = createContact(db, 'a', { name: 'Bobby' });
    if (!c.ok) throw new Error('contact');
    expect(linkContact(db, 'a', c.id, 'b').ok).toBe(true);
    expect(inviteMany(db, 'a', recent, { contactIds: [c.id], newNames: [] }).ok).toBe(true);
    db.update(invitation).set({ status: 'yes' }).where(eq(invitation.contactId, c.id)).run();
    const seen = getProfile(db, 'b', 'a')!;
    expect(seen.rides.find((x) => x.title === 'Récente')?.withViewer).toBe(true);
    expect(seen.rides.find((x) => x.title === 'Vieille')?.withViewer).toBe(false);
    expect(seen.shared).toEqual([]);

    // On Alice's side: Bob organises, Alice (linked buddy) comes; Bob's outing can be opened by him, listed on Alice's profile.
    const bobOuting = await mk('b', '2020-08-01', 'Chez Bob');
    const cb = createContact(db, 'b', { name: 'Alice' });
    if (!cb.ok) throw new Error('contact');
    linkContact(db, 'b', cb.id, 'a');
    inviteMany(db, 'b', bobOuting, { contactIds: [cb.id], newNames: [] });
    db.update(invitation).set({ status: 'yes' }).where(eq(invitation.contactId, cb.id)).run();
    const shared = getProfile(db, 'b', 'a')!.shared;
    expect(shared.map((x) => x.title)).toEqual(['Chez Bob']);
    expect(shared[0].slug).toBe(bobOuting);
  });
});
