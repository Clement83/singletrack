import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { friendship, invitation, outing, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import {
  createOuting, getInvitationByToken, joinVisibleOuting, listJoinedOutings, listVisibleOutings, reopenJoinedOuting, revokeInvitation, encryptToken, setStatus,
} from '@/lib/outings';

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values(['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase(), email: `${id}@x.fr` }))).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 20] as [number, number, number]) }, raw: {},
  }, { enrich: false });
  let n = 0;
  const mk = async (owner: string, extra: object = {}) => {
    const r = await createOuting(db, owner, { trackSlug: t.slug, title: `Sortie ${++n}`, date: '2099-05-10', time: '08:30', ...extra });
    if (!('slug' in r)) throw new Error('création');
    // Ces tests couvrent des sorties « publiques » encore pourvues d'un propriétaire (antérieures à #1455) : on le leur rend.
    db.update(outing).set({ ownerId: owner }).where(eq(outing.slug, r.slug)).run();
    return db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
  };
  const friend = (x: string, y: string) =>
    db.insert(friendship).values({ requesterId: x, addresseeId: y, pairKey: [x, y].sort().join(':'), status: 'accepted' }).run();
  return { db, mk, friend };
}

describe('rejoindre une sortie visible (#1444)', () => {
  it('rejoint (public), « je viens », origine self, idempotent', async () => {
    const { db, mk } = await setup();
    const o = await mk('a', { visibility: 'public' });
    expect(joinVisibleOuting(db, 'b', o.id)).toEqual({ ok: true, already: false });
    expect(joinVisibleOuting(db, 'b', o.id)).toEqual({ ok: true, already: true });
    const invs = db.select().from(invitation).where(eq(invitation.outingId, o.id)).all();
    expect(invs).toHaveLength(1);
    expect(invs[0]).toMatchObject({ userId: 'b', name: 'B', status: 'yes', origin: 'self' });
    expect(listVisibleOutings(db, 'b')).toHaveLength(0);
    expect(listJoinedOutings(db, 'b').map((j) => j.id)).toEqual([o.id]);
    expect(Object.keys(listJoinedOutings(db, 'b')[0]).sort()).not.toContain('slug');
  });

  it('visibilité : copain / non-copain / invite seulement / organisateur → not_found', async () => {
    const { db, mk, friend } = await setup();
    const f = await mk('a', { visibility: 'friends' });
    const p = await mk('a', { visibility: 'invite' });
    expect(joinVisibleOuting(db, 'b', f.id)).toEqual({ ok: false, error: 'not_found' });
    friend('a', 'b');
    expect(joinVisibleOuting(db, 'b', f.id).ok).toBe(true);
    expect(joinVisibleOuting(db, 'b', p.id)).toEqual({ ok: false, error: 'not_found' });
    expect(joinVisibleOuting(db, 'a', f.id)).toEqual({ ok: false, error: 'not_found' });
    expect(joinVisibleOuting(db, 'b', 'inconnue')).toEqual({ ok: false, error: 'not_found' });
  });

  it('annulée, passée, pleine', async () => {
    const { db, mk } = await setup();
    const c = await mk('a', { visibility: 'public' });
    setStatus(db, 'a', c.slug, 'cancelled');
    expect(joinVisibleOuting(db, 'b', c.id)).toEqual({ ok: false, error: 'closed' });
    const past = await mk('a', { visibility: 'public' });
    expect(joinVisibleOuting(db, 'b', past.id, new Date('2100-01-01')).ok).toBe(false);
    const full = await mk('a', { visibility: 'public', maxParticipants: 1 });
    expect(joinVisibleOuting(db, 'b', full.id)).toEqual({ ok: true, already: false });
    expect(joinVisibleOuting(db, 'c', full.id)).toEqual({ ok: false, error: 'full' });
  });

  it('rouvrir : même lien déchiffré, rien n’est régénéré ; révocation', async () => {
    const { db, mk } = await setup();
    const o = await mk('a', { visibility: 'public' });
    expect(reopenJoinedOuting(db, 'b', o.id)).toEqual({ ok: false, error: 'not_found' });
    joinVisibleOuting(db, 'b', o.id);
    const r1 = reopenJoinedOuting(db, 'b', o.id);
    if (!r1.ok) throw new Error('reopen');
    expect(getInvitationByToken(db, r1.token)?.invitation.userId).toBe('b');
    expect(reopenJoinedOuting(db, 'b', o.id)).toEqual({ ok: true, token: r1.token });
    expect(getInvitationByToken(db, r1.token)).toBeDefined();
    expect(reopenJoinedOuting(db, 'c', o.id)).toEqual({ ok: false, error: 'not_found' });
    // Lien créé avant le chiffrement : non réaffichable, jamais régénéré
    db.update(invitation).set({ tokenEnc: null }).where(eq(invitation.userId, 'b')).run();
    expect(reopenJoinedOuting(db, 'b', o.id)).toEqual({ ok: false, error: 'linkUnavailable' });
    expect(getInvitationByToken(db, r1.token)).toBeDefined();
    db.update(invitation).set({ tokenEnc: encryptToken(r1.token) }).where(eq(invitation.userId, 'b')).run();
    const inv = db.select().from(invitation).where(eq(invitation.outingId, o.id)).get()!;
    expect(revokeInvitation(db, 'a', o.slug, inv.id).ok).toBe(true);
    expect(reopenJoinedOuting(db, 'b', o.id)).toEqual({ ok: false, error: 'not_found' });
    expect(listJoinedOutings(db, 'b')).toHaveLength(0);
    expect(joinVisibleOuting(db, 'b', o.id)).toEqual({ ok: false, error: 'not_found' });
  });
});
