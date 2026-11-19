import { describe, it, expect, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { invitation, outing, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import {
  archiveOuting, archiveOverrides, cancelOuting, createOuting, isArchivedFor, leaveOuting, listJoinedOutings, ownerDepart, transferCandidates,
} from '@/lib/outings';
import { outingNoticeMail } from '@/lib/mail-templates';

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values(['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), email: `${id}@x.fr`, locale: id === 'c' ? 'en' : null }))).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 20] as [number, number, number]) }, raw: {},
  }, { enrich: false });
  const mk = async (owner: string, extra: object = {}) => {
    const r = await createOuting(db, owner, { trackSlug: t.slug, title: 'Sortie', date: '2099-05-10', time: '08:30', ...extra });
    if (!('slug' in r)) throw new Error('création');
    return db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
  };
  const join = (o: { id: string }, uid: string, status: 'yes' | 'pending' = 'yes') =>
    db.insert(invitation).values({ outingId: o.id, tokenHash: `h${Math.random()}`, userId: uid, name: uid.toUpperCase(), status }).run();
  return { db, mk, join };
}

describe('archiver et quitter (#1459)', () => {
  it('quitter : réponse « non » et sortie archivée pour soi seulement', async () => {
    const { db, mk, join } = await setup();
    const o = await mk('a'); join(o, 'b'); join(o, 'c');
    expect(leaveOuting(db, 'b', o.id)).toEqual({ ok: true });
    expect(db.select().from(invitation).where(and(eq(invitation.outingId, o.id), eq(invitation.userId, 'b'))).get()!.status).toBe('no');
    expect(db.select().from(invitation).where(and(eq(invitation.outingId, o.id), eq(invitation.userId, 'c'))).get()!.status).toBe('yes');
    expect(isArchivedFor(archiveOverrides(db, 'b'), o)).toBe(true);
    expect(isArchivedFor(archiveOverrides(db, 'c'), o)).toBe(false);
  });
  it('quitter : étranger ⇒ not_found, propriétaire ⇒ doit choisir, sortie passée ⇒ closed', async () => {
    const { db, mk, join } = await setup();
    const o = await mk('a'); join(o, 'b');
    expect(leaveOuting(db, 'd', o.id)).toEqual({ ok: false, error: 'not_found' });
    expect(leaveOuting(db, 'a', o.id)).toEqual({ ok: false, error: 'ownerMustChoose' });
    expect(leaveOuting(db, 'b', o.id, new Date('2100-01-01'))).toEqual({ ok: false, error: 'closed' });
  });
  it('quitter : le créateur d’une publique (sans invitation) la masque pour lui', async () => {
    const { db, mk } = await setup();
    const o = await mk('a', { visibility: 'public' });
    await ownerDepart(db, 'a', o.slug, { choice: 'public' }).valueOf();
    const p = db.select().from(outing).where(eq(outing.id, o.id)).get()!;
    expect(p.ownerId).toBeNull();
    expect(archiveOuting(db, 'a', p.id, false)).toEqual({ ok: true });
    expect(leaveOuting(db, 'a', p.id)).toEqual({ ok: true });
    expect(isArchivedFor(archiveOverrides(db, 'a'), p)).toBe(true);
  });
  it('archivage automatique des passées, désarchiver possible, rien d’autre ne change', async () => {
    const { db, mk, join } = await setup();
    const o = await mk('a'); join(o, 'b');
    const later = new Date('2100-01-01');
    expect(isArchivedFor(new Map(), o, later)).toBe(true);
    expect(isArchivedFor(new Map(), o)).toBe(false);
    expect(archiveOuting(db, 'b', o.id, false)).toEqual({ ok: true });
    expect(isArchivedFor(archiveOverrides(db, 'b'), o, later)).toBe(false);
    expect(archiveOuting(db, 'b', o.id, true)).toEqual({ ok: true });
    expect(archiveOuting(db, 'd', o.id, true)).toEqual({ ok: false, error: 'not_found' });
    expect(listJoinedOutings(db, 'b')).toHaveLength(1); // stats / profile / base list untouched
    expect(db.select().from(outing).where(eq(outing.id, o.id)).get()!.status).toBe('planned');
  });
});

describe('départ du propriétaire (#1459)', () => {
  it('supprimer : annulée, mail à chaque participant avec compte (langue du compte), pas aux autres ni à soi', async () => {
    const { db, mk, join } = await setup();
    const o = await mk('a', { visibility: 'invite' }); join(o, 'b'); join(o, 'c'); join(o, 'd', 'pending');
    db.update(invitation).set({ status: 'no' }).where(and(eq(invitation.outingId, o.id), eq(invitation.userId, 'd'))).run();
    db.insert(invitation).values({ outingId: o.id, tokenHash: 'g', name: 'Invité sans compte', status: 'yes' }).run();
    const mailer = vi.fn(async () => {});
    expect(ownerDepart(db, 'a', o.slug, { choice: 'delete' }, mailer)).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(db.select().from(outing).where(eq(outing.id, o.id)).get()!.status).toBe('cancelled');
    const calls = mailer.mock.calls as unknown as [{ to: string; subject: string }][];
    expect(calls.map((c) => c[0].to).sort()).toEqual(['b@x.fr', 'c@x.fr']);
    expect(calls.find((c) => c[0].to === 'c@x.fr')![0].subject).toMatch(/deleted/i);
    expect(isArchivedFor(archiveOverrides(db, 'a'), o)).toBe(true);
  });
  it('« Supprimer » sans quitter : annule + mail, pas de double mail si déjà annulée', async () => {
    const { db, mk, join } = await setup();
    const o = await mk('a'); join(o, 'b');
    const mailer = vi.fn(async () => {});
    expect(cancelOuting(db, 'a', o.slug, mailer)).toEqual({ ok: true });
    expect(cancelOuting(db, 'a', o.slug, mailer)).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(mailer).toHaveBeenCalledTimes(1);
    expect(cancelOuting(db, 'b', o.slug, mailer)).toEqual({ ok: false, error: 'not_found' });
  });
  it('rendre publique : figée, sans propriétaire, archivée pour l’ancien propriétaire', async () => {
    const { db, mk } = await setup();
    const o = await mk('a');
    expect(ownerDepart(db, 'a', o.slug, { choice: 'public' })).toEqual({ ok: true });
    const p = db.select().from(outing).where(eq(outing.id, o.id)).get()!;
    expect(p).toMatchObject({ ownerId: null, visibility: 'public', status: 'planned' });
    expect(isArchivedFor(archiveOverrides(db, 'a'), p)).toBe(true);
  });
  it('confier : seulement à un participant avec compte, mail au nouveau propriétaire, l’ancien quitte', async () => {
    const { db, mk, join } = await setup();
    const o = await mk('a'); join(o, 'b');
    const mailer = vi.fn(async () => {});
    expect(transferCandidates(db, o.id, 'a')).toEqual([{ userId: 'b', name: 'B' }]);
    expect(ownerDepart(db, 'a', o.slug, { choice: 'transfer', newOwnerId: 'd' }, mailer)).toEqual({ ok: false, error: 'notCandidate' });
    expect(ownerDepart(db, 'a', o.slug, { choice: 'transfer', newOwnerId: 'b' }, mailer)).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(db.select().from(outing).where(eq(outing.id, o.id)).get()!.ownerId).toBe('b');
    expect((mailer.mock.calls as unknown as [{ to: string }][]).map((c) => c[0].to)).toEqual(['b@x.fr']);
    expect(isArchivedFor(archiveOverrides(db, 'a'), o)).toBe(true);
    expect(ownerDepart(db, 'a', o.slug, { choice: 'delete' })).toEqual({ ok: false, error: 'not_found' });
  });
  it('mails FR et EN', () => {
    const d = { kind: 'cancelled' as const, who: 'Anne', title: 'Boucle', date: 'sam.', url: 'https://x/i/t' };
    expect(outingNoticeMail('a@x.fr', d, 'fr').subject).toContain('supprimée');
    expect(outingNoticeMail('a@x.fr', d, 'en').subject).toContain('deleted');
    expect(outingNoticeMail('a@x.fr', { ...d, kind: 'transferred', url: null }, 'en').html).not.toContain('<a ');
  });
});
