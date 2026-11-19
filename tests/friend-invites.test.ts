import { describe, it, expect, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { contact, friendship, invitation, outing, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { createOuting, inviteFriends, listInvitableFriends, listJoinedOutings, makePublic, getInvitationByToken, decryptToken } from '@/lib/outings';
import { friendInviteMail } from '@/lib/mail-templates';

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id.toUpperCase(), email: `${id}@x.fr`, locale: id === 'c' ? 'en' : null }))).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 20] as [number, number, number]) }, raw: {},
  }, { enrich: false });
  let n = 0;
  const mk = async (owner: string, extra: object = {}) => {
    const r = await createOuting(db, owner, { trackSlug: t.slug, title: `Sortie ${++n}`, date: '2099-05-10', time: '08:30', ...extra });
    if (!('slug' in r)) throw new Error('création');
    return db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
  };
  const friend = (x: string, y: string) =>
    db.insert(friendship).values({ requesterId: x, addresseeId: y, pairKey: [x, y].sort().join(':'), status: 'accepted' }).run();
  const join = (o: { id: string }, uid: string, status: 'yes' | 'pending' = 'yes') =>
    db.insert(invitation).values({ outingId: o.id, tokenHash: `h${Math.random()}`, userId: uid, name: uid, status }).run();
  return { db, mk, friend, join };
}

describe('inviter ses copains (#1458)', () => {
  it('propriétaire : invitation liée au compte, créée par lui, mail en arrière-plan, sortie dans « Mes sorties » du copain', async () => {
    const { db, mk, friend } = await setup();
    friend('a', 'b'); friend('a', 'c');
    const o = await mk('a', { visibility: 'invite' });
    const mailer = vi.fn(async () => {});
    const r = inviteFriends(db, 'a', o, ['b', 'c'], mailer);
    expect(r).toEqual({ ok: true, invited: ['B', 'C'], skipped: [] });
    const inv = db.select().from(invitation).where(and(eq(invitation.outingId, o.id), eq(invitation.userId, 'b'))).get()!;
    expect(inv).toMatchObject({ name: 'B', status: 'pending', createdByUserId: 'a', origin: 'personal' });
    expect(decryptToken(inv.tokenEnc)).toBeTruthy();
    expect(listJoinedOutings(db, 'b').map((j) => j.id)).toEqual([o.id]);
    await vi.waitFor(() => expect(mailer).toHaveBeenCalledTimes(2));
    const calls = mailer.mock.calls as unknown as [{ to: string; subject: string; html: string }][];
    const mailC = calls.map((x) => x[0]).find((m) => m.to === 'c@x.fr')!;
    expect(mailC.subject).toContain('invited you');
    expect(mailC.html).toContain(`/i/${decryptToken(db.select().from(invitation).where(eq(invitation.userId, 'c')).get()!.tokenEnc)}`);
  });

  it('doublons : copain déjà invité ou participant ignoré, relancer ne recrée rien', async () => {
    const { db, mk, friend, join } = await setup();
    friend('a', 'b'); friend('a', 'c');
    const o = await mk('a');
    join(o, 'b');
    const mailer = vi.fn(async () => {});
    expect(inviteFriends(db, 'a', o, ['b', 'c'], mailer)).toEqual({ ok: true, invited: ['C'], skipped: ['B'] });
    expect(inviteFriends(db, 'a', o, ['c'], mailer)).toEqual({ ok: true, invited: [], skipped: ['C'] });
    expect(db.select().from(invitation).where(eq(invitation.outingId, o.id)).all()).toHaveLength(2);
    expect(listInvitableFriends(db, 'a', o)).toEqual([]);
  });

  it('seuls les copains acceptés : un inconnu ou une demande en attente est ignoré', async () => {
    const { db, mk, friend } = await setup();
    friend('a', 'b');
    db.insert(friendship).values({ requesterId: 'a', addresseeId: 'd', pairKey: 'a:d', status: 'pending' }).run();
    const o = await mk('a');
    expect(inviteFriends(db, 'a', o, ['d', 'e', 'a'], vi.fn(async () => {}))).toEqual({ ok: true, invited: [], skipped: [] });
    expect(db.select().from(invitation).all()).toHaveLength(0);
    expect(inviteFriends(db, 'a', o, [], vi.fn()).ok).toBe(false);
  });

  it('droits : privée sans option → participant refusé ; avec option → autorisé (ses copains à lui) ; non participant refusé', async () => {
    const { db, mk, friend, join } = await setup();
    friend('b', 'c'); friend('a', 'b');
    const o = await mk('a', { visibility: 'invite' });
    join(o, 'b');
    const mailer = vi.fn(async () => {});
    expect(inviteFriends(db, 'b', o, ['c'], mailer)).toEqual({ ok: false, error: 'not_found' });
    expect(listInvitableFriends(db, 'b', o)).toEqual([]);
    db.update(outing).set({ participantsCanInvite: true }).where(eq(outing.id, o.id)).run();
    const o2 = db.select().from(outing).where(eq(outing.id, o.id)).get()!;
    expect(listInvitableFriends(db, 'b', o2).map((f) => f.userId)).toEqual(['c']); // the organiser is excluded
    expect(inviteFriends(db, 'b', o2, ['c'], mailer)).toEqual({ ok: true, invited: ['C'], skipped: [] });
    expect(db.select().from(invitation).where(eq(invitation.userId, 'c')).get()!.createdByUserId).toBe('b');
    // someone who is not in the outing, or only answered "maybe"
    expect(inviteFriends(db, 'c', o2, ['b'], mailer).ok).toBe(false);
    db.update(invitation).set({ status: 'pending' }).where(eq(invitation.userId, 'b')).run();
    expect(inviteFriends(db, 'b', o2, ['c'], mailer)).toEqual({ ok: false, error: 'not_found' });
  });

  it('publique : tout participant (et le créateur) invite ; sortie passée ou annulée refusée', async () => {
    const { db, mk, friend, join } = await setup();
    friend('a', 'b'); friend('b', 'c'); friend('a', 'd');
    const priv = await mk('a');
    expect(makePublic(db, 'a', priv.slug).ok).toBe(true);
    const o = db.select().from(outing).where(eq(outing.id, priv.id)).get()!;
    join(o, 'b');
    const mailer = vi.fn(async () => {});
    expect(inviteFriends(db, 'b', o, ['c'], mailer)).toEqual({ ok: true, invited: ['C'], skipped: [] });
    expect(inviteFriends(db, 'a', o, ['d'], mailer)).toEqual({ ok: true, invited: ['D'], skipped: [] });
    db.update(outing).set({ status: 'cancelled' }).where(eq(outing.id, o.id)).run();
    const cancelled = db.select().from(outing).where(eq(outing.id, o.id)).get()!;
    friend('b', 'e');
    expect(inviteFriends(db, 'b', cancelled, ['e'], mailer)).toEqual({ ok: false, error: 'closed' });
    void getInvitationByToken;
  });

  it('carnet : un pote lié au compte du copain est rattaché à l’invitation', async () => {
    const { db, mk, friend } = await setup();
    friend('a', 'b');
    const c = db.insert(contact).values({ ownerUserId: 'a', name: 'Bibi', userId: 'b' }).returning().get();
    const o = await mk('a');
    inviteFriends(db, 'a', o, ['b'], vi.fn(async () => {}));
    expect(db.select().from(invitation).where(eq(invitation.userId, 'b')).get()!.contactId).toBe(c.id);
  });

  it('mail FR / EN', () => {
    const d = { inviter: 'Léa', title: 'Boucle', date: 'samedi 10 mai', url: 'https://x.test/i/abc' };
    const fr = friendInviteMail('b@x.fr', d, 'fr');
    const en = friendInviteMail('b@x.fr', d, 'en');
    expect(fr.subject).toBe('Léa t’invite : Boucle');
    expect(en.subject).toBe('Léa invited you: Boucle');
    expect(fr.html).toContain('https://x.test/i/abc');
    expect(fr.text).toContain('https://x.test/i/abc');
    expect(friendInviteMail('b@x.fr', { ...d, inviter: '<b>' }, 'fr').html).not.toContain('<b>');
  });
});
