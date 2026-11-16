import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { contact, invitation, outing, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { createInvitation, createOuting, createContact, inviteMany, respond, revokeInvitation } from '@/lib/outings';
import { areFriends, claimInvitation, listFriends } from '@/lib/friends';
import { getProfile } from '@/lib/user-profile';
import { safeNext } from '@/lib/safe-next';

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([
    { id: 'o', name: 'Orga', email: 'o@x.fr' }, { id: 'g', name: 'Gaston', email: 'g@x.fr' }, { id: 'h', name: 'Hugo', email: 'h@x.fr' },
  ]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: [[6.1, 43.2, 100], [6.11, 43.21, 180], [6.1, 43.2, 101]] }, raw: {},
  }, { enrich: false });
  const o = await createOuting(db, 'o', { trackSlug: t.slug, title: 'Dimanche', date: '2099-05-10', time: '08:30' });
  if (!('slug' in o)) throw new Error('création');
  const inv = createInvitation(db, 'o', o.slug, 'Gaston');
  if (!inv.ok) throw new Error('invitation');
  return { db, slug: o.slug, token: inv.token, id: inv.id };
}

describe('rattacher un invité à son compte (#1434)', () => {
  it('rattache, devient copain de l’organisateur, le lien reste utilisable', async () => {
    const { db, token, id } = await setup();
    expect(claimInvitation(db, 'g', token)).toEqual({ ok: true, organizerId: 'o' });
    expect(db.select().from(invitation).where(eq(invitation.id, id)).get()!.userId).toBe('g');
    expect(areFriends(db, 'g', 'o')).toBe(true);
    expect(listFriends(db, 'o').friends.map((f) => f.name)).toEqual(['Gaston']);
    expect(respond(db, token, { status: 'yes' }).ok).toBe(true);
  });

  it('double rattachement refusé (autre compte, même compte, même sortie)', async () => {
    const { db, token, slug } = await setup();
    expect(claimInvitation(db, 'g', token).ok).toBe(true);
    expect(claimInvitation(db, 'h', token)).toEqual({ ok: false, error: 'alreadyClaimed' });
    expect(claimInvitation(db, 'g', token)).toEqual({ ok: false, error: 'alreadyClaimedByYou' });
    const second = createInvitation(db, 'o', slug, 'Gaston bis');
    if (!second.ok) throw new Error();
    expect(claimInvitation(db, 'g', second.token)).toEqual({ ok: false, error: 'alreadyOnOuting' });
  });

  it('lien révoqué ou inconnu : refusé ; l’organisateur ne se rattache pas', async () => {
    const { db, token, slug, id } = await setup();
    expect(claimInvitation(db, 'o', token)).toEqual({ ok: false, error: 'selfFriend' });
    expect(claimInvitation(db, 'g', 'x'.repeat(43))).toEqual({ ok: false, error: 'not_found' });
    revokeInvitation(db, 'o', slug, id);
    expect(claimInvitation(db, 'g', token)).toEqual({ ok: false, error: 'not_found' });
    expect(areFriends(db, 'g', 'o')).toBe(false);
  });

  it('lie le pote du carnet au compte', async () => {
    const { db, slug } = await setup();
    const c = createContact(db, 'o', { name: 'Hugo' });
    if (!c.ok) throw new Error();
    const r = inviteMany(db, 'o', slug, { contactIds: [c.id], newNames: [] });
    if (!r.ok) throw new Error();
    expect(claimInvitation(db, 'h', r.invites[0].token).ok).toBe(true);
    expect(db.select().from(contact).where(eq(contact.id, c.id)).get()!.userId).toBe('h');
  });

  it('les sorties passées comptent dans les stats du compte rattaché', async () => {
    const { db, token } = await setup();
    claimInvitation(db, 'g', token);
    respond(db, token, { status: 'yes' });
    db.update(outing).set({ startsAt: new Date('2020-01-01T08:00:00Z') }).run();
    const p = getProfile(db, 'g', 'g')!;
    expect(p.totals.outings).toBe(1);
    expect(p.rides.map((r) => r.title)).toEqual(['Dimanche']);
    expect(p.rides[0]).not.toHaveProperty('slug');
  });

  it('safeNext n’accepte que les liens invités', () => {
    expect(safeNext(`/i/${'a'.repeat(43)}`)).toBe(`/i/${'a'.repeat(43)}`);
    expect(safeNext('https://evil.fr')).toBeUndefined();
    expect(safeNext('//evil.fr')).toBeUndefined();
    expect(safeNext('/sorties')).toBeUndefined();
  });
});
