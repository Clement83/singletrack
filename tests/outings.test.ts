import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { invitation, track, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import {
  createContact, createInvitation, createOuting, duplicateOuting, inviteMany, listInvitations, reinviteCandidates, updateContact, getInvitationByToken, getOwnedOuting, hashToken, isClosed, joinOpen, listOutings, parisToUtc,
  rateLimit, refreshSnapshot, respond, revokeInvitation, getInvitationLink, setOpenLink, setStatus, updateOuting, utcToParisInputs,
} from '@/lib/outings';

async function setup() {
  const { db, sqlite } = openDb(':memory:');
  const now = new Date();
  db.insert(user).values([
    { id: 'u1', name: 'Orga', email: 'o@x.fr' },
    { id: 'u2', name: 'Autre', email: 'a@x.fr' },
  ]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: [[6.1, 43.2, 100], [6.11, 43.21, 180], [6.1, 43.2, 101]] }, raw: {},
  }, { enrich: false });
  const base = { trackSlug: t.slug, title: 'Dimanche', date: '2099-05-10', time: '08:30' };
  const o1 = await createOuting(db, 'u1', base);
  if (!('slug' in o1)) throw new Error('création');
  return { db, sqlite, t, o1: o1.slug, base, now };
}

describe('sorties', () => {
  it('une trace → deux sorties à des dates différentes, snapshot figé', async () => {
    const { db, t, o1, base } = await setup();
    const o2 = await createOuting(db, 'u1', { ...base, date: '2099-06-14' });
    expect('slug' in o2 && o2.slug !== o1).toBe(true);
    db.update(track).set({ name: 'Renommée', distanceM: 99999 }).where(eq(track.slug, t.slug)).run();
    const o = getOwnedOuting(db, 'u1', o1)!;
    expect(o.trackSnapshot.name).toBe('Boucle');
    expect(o.trackSnapshot.distanceM).not.toBe(99999);
    expect(refreshSnapshot(db, 'u1', o1).ok).toBe(true);
    expect(getOwnedOuting(db, 'u1', o1)!.trackSnapshot.name).toBe('Renommée');
    expect(refreshSnapshot(db, 'u2', o1)).toEqual({ ok: false, error: 'not_found' });
  });

  it('valide les champs et convertit Paris → UTC', async () => {
    const { db, base } = await setup();
    expect(await createOuting(db, 'u1', { ...base, title: ' ' })).toHaveProperty('errors.title');
    expect(await createOuting(db, 'u1', { ...base, date: 'nope' })).toHaveProperty('errors.date');
    expect(await createOuting(db, 'u1', { ...base, level: 'x' })).toHaveProperty('errors.level');
    expect(await createOuting(db, 'u1', { ...base, trackSlug: 'inconnu' })).toEqual({ error: 'not_found' });
    expect(parisToUtc('2026-07-01', '10:00')!.toISOString()).toBe('2026-07-01T08:00:00.000Z'); // summer UTC+2
    expect(parisToUtc('2026-01-15', '10:00')!.toISOString()).toBe('2026-01-15T09:00:00.000Z'); // hiver UTC+1
    expect(utcToParisInputs(new Date('2026-07-01T08:00:00Z'))).toEqual({ date: '2026-07-01', time: '10:00' });
  });

  it('autorisations organisateur : un autre utilisateur ne voit ni ne modifie rien', async () => {
    const { db, o1 } = await setup();
    expect(getOwnedOuting(db, 'u2', o1)).toBeUndefined();
    expect(updateOuting(db, 'u2', o1, { title: 'Hack' })).toEqual({ ok: false, error: 'not_found' });
    expect(setStatus(db, 'u2', o1, 'cancelled').ok).toBe(false);
    expect(createInvitation(db, 'u2', o1, 'Zed').ok).toBe(false);
    expect(setOpenLink(db, 'u2', o1, true).ok).toBe(false);
    expect(updateOuting(db, 'u1', o1, { title: 'Nouveau' }).ok).toBe(true);
    expect(getOwnedOuting(db, 'u1', o1)!.title).toBe('Nouveau');
    expect(listOutings(db, 'u1').upcoming).toHaveLength(1);
    expect(listOutings(db, 'u2').upcoming).toHaveLength(0);
  });

  it('invitations nominatives : le token en clair n\'est jamais stocké', async () => {
    const { db, sqlite, o1 } = await setup();
    const r = createInvitation(db, 'u1', o1, 'Julien');
    if (!r.ok) throw new Error();
    expect(r.token.length).toBeGreaterThanOrEqual(43); // 256 bits in base64url
    const rows = db.select().from(invitation).all();
    expect(rows[0].tokenHash).toBe(hashToken(r.token));
    expect(JSON.stringify(sqlite.prepare('select * from invitation').all())).not.toContain(r.token);
    expect(getInvitationByToken(db, r.token)?.invitation.name).toBe('Julien');
    expect(getInvitationByToken(db, 'x'.repeat(43))).toBeUndefined();
    expect(createInvitation(db, 'u1', o1, '  ')).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('GO passe en yes ; le lien de Julien ne touche pas Marc ; révocation → introuvable', async () => {
    const { db, o1 } = await setup();
    const j = createInvitation(db, 'u1', o1, 'Julien');
    const m = createInvitation(db, 'u1', o1, 'Marc');
    if (!j.ok || !m.ok) throw new Error();
    expect(respond(db, j.token, { status: 'yes', comment: 'en VAE' }).ok).toBe(true);
    const rows = db.select().from(invitation).all();
    expect(rows.find((r) => r.name === 'Julien')).toMatchObject({ status: 'yes', comment: 'en VAE' });
    expect(rows.find((r) => r.name === 'Marc')).toMatchObject({ status: 'pending', comment: null });
    expect(respond(db, j.token, { status: 'oui' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(respond(db, j.token, { name: 'Jul' }).ok).toBe(true);
    expect(respond(db, j.token, { status: 'maybe' }).ok).toBe(true);
    // Revocation
    expect(revokeInvitation(db, 'u2', o1, m.id).ok).toBe(false);
    expect(revokeInvitation(db, 'u1', o1, m.id).ok).toBe(true);
    expect(getInvitationByToken(db, m.token)).toBeUndefined();
    expect(respond(db, m.token, { status: 'yes' })).toEqual({ ok: false, error: 'not_found' });
    // No regeneration: the link is shown again as is (#1456); revoked ⇒ no link
    expect(getInvitationLink(db, 'u1', o1, j.id)).toEqual({ ok: true, token: j.token });
    expect(getInvitationLink(db, 'u1', o1, j.id)).toEqual({ ok: true, token: j.token });
    expect(getInvitationLink(db, 'u2', o1, j.id)).toEqual({ ok: false, error: 'not_found' });
    expect(getInvitationLink(db, 'u1', o1, m.id)).toEqual({ ok: false, error: 'not_found' });
  });

  it('sortie annulée ou passée : réponses figées', async () => {
    const { db, o1, base } = await setup();
    const j = createInvitation(db, 'u1', o1, 'Julien');
    if (!j.ok) throw new Error();
    setStatus(db, 'u1', o1, 'cancelled');
    expect(respond(db, j.token, { status: 'yes' })).toEqual({ ok: false, error: 'closed' });
    setStatus(db, 'u1', o1, 'planned');
    expect(respond(db, j.token, { status: 'yes' }).ok).toBe(true);
    expect(respond(db, j.token, { status: 'no' }, new Date('2100-01-01')).ok).toBe(false);
    expect(isClosed({ status: 'planned', startsAt: new Date('2099-05-10T07:00:00Z') }, new Date('2099-05-10T08:00:00Z'))).toBe(false);
    const past = await createOuting(db, 'u1', { ...base, date: '2020-01-01' });
    expect(listOutings(db, 'u1').past).toHaveLength(1);
    expect('slug' in past).toBe(true);
  });

  it('complet : max_participants bloque les nouveaux « GO »', async () => {
    const { db, o1 } = await setup();
    updateOuting(db, 'u1', o1, { maxParticipants: 1 });
    const a = createInvitation(db, 'u1', o1, 'A');
    const b = createInvitation(db, 'u1', o1, 'B');
    if (!a.ok || !b.ok) throw new Error();
    expect(respond(db, a.token, { status: 'yes' }).ok).toBe(true);
    expect(respond(db, a.token, { status: 'yes' }).ok).toBe(true); // already in
    expect(respond(db, b.token, { status: 'yes' })).toEqual({ ok: false, error: 'full' });
    expect(respond(db, b.token, { status: 'maybe' }).ok).toBe(true);
  });

  it('lien ouvert : désactivé par défaut, crée une invitation perso', async () => {
    const { db, o1 } = await setup();
    const o = getOwnedOuting(db, 'u1', o1)!;
    expect(joinOpen(db, o.openLinkToken, 'Paul')).toEqual({ ok: false, error: 'disabled' });
    setOpenLink(db, 'u1', o1, true);
    const r = joinOpen(db, o.openLinkToken, 'Paul');
    if (!r.ok) throw new Error();
    expect(getInvitationByToken(db, r.token)?.invitation).toMatchObject({ name: 'Paul', origin: 'open_link' });
    expect(joinOpen(db, o.openLinkToken, '')).toMatchObject({ ok: false, error: 'invalid' });
    setOpenLink(db, 'u1', o1, false);
    expect(joinOpen(db, o.openLinkToken, 'Eve')).toEqual({ ok: false, error: 'disabled' });
    // The open link's token never opens the organiser page
    expect(getOwnedOuting(db, 'u1', o.openLinkToken)).toBeUndefined();
  });

  it('rate limit', () => {
    expect(rateLimit('k', 2, 1000, 0)).toBe(true);
    expect(rateLimit('k', 2, 1000, 1)).toBe(true);
    expect(rateLimit('k', 2, 1000, 2)).toBe(false);
    expect(rateLimit('k', 2, 1000, 1001)).toBe(true);
  });
});

describe('dupliquer une sortie (#1360)', () => {
  it('copie la sortie à une autre date, sans invitations, indépendante de l’original', async () => {
    const { db, t, o1 } = await setup();
    updateOuting(db, 'u1', o1, { description: 'Café avant', level: 'enduro', ebike: 'no', maxParticipants: 6 });
    createInvitation(db, 'u1', o1, 'Paul');
    db.update(track).set({ name: 'Renommée' }).where(eq(track.slug, t.slug)).run();
    const r = duplicateOuting(db, 'u1', o1, { date: '2099-05-17', time: '08:30' });
    if (!r.ok) throw new Error('duplication');
    expect(r.slug).not.toBe(o1);
    const a = getOwnedOuting(db, 'u1', o1)!;
    const b = getOwnedOuting(db, 'u1', r.slug)!;
    expect(b.id).not.toBe(a.id);
    expect(b.openLinkToken).not.toBe(a.openLinkToken);
    expect([b.title, b.description, b.level, b.ebike, b.maxParticipants, b.trackId]).toEqual([a.title, a.description, a.level, a.ebike, a.maxParticipants, a.trackId]);
    expect(utcToParisInputs(b.startsAt)).toEqual({ date: '2099-05-17', time: '08:30' });
    expect(listInvitations(db, b.id)).toHaveLength(0);
    expect(b.trackSnapshot.name).toBe('Renommée'); // default: current version of the track
    expect(a.trackSnapshot.name).toBe('Boucle');
    updateOuting(db, 'u1', r.slug, { title: 'Autre' });
    expect(getOwnedOuting(db, 'u1', o1)!.title).toBe('Dimanche');
    const s = duplicateOuting(db, 'u1', o1, { date: '2099-05-24', time: '08:30', trackSource: 'snapshot' });
    expect(s.ok && getOwnedOuting(db, 'u1', (s as { slug: string }).slug)!.trackSnapshot.name).toBe('Boucle');
  });

  it('refuse sans date valide ou pour une sortie d’un autre', async () => {
    const { db, o1 } = await setup();
    expect(duplicateOuting(db, 'u1', o1, { time: '08:30' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(duplicateOuting(db, 'u2', o1, { date: '2099-05-17', time: '08:30' })).toEqual({ ok: false, error: 'not_found' });
  });

  it('réinviter : contacts actifs du carnet et prénoms sans contact, hors révoqués et archivés', async () => {
    const { db, o1 } = await setup();
    const c1 = createContact(db, 'u1', { name: 'Léa' });
    const c2 = createContact(db, 'u1', { name: 'Marc' });
    if (!c1.ok || !c2.ok) throw new Error('contacts');
    inviteMany(db, 'u1', o1, { contactIds: [c1.id, c2.id], newNames: [{ name: 'Zoé', addToBook: false }] });
    updateContact(db, 'u1', c2.id, { archived: true });
    const out = reinviteCandidates(db, 'u1', o1);
    expect(out.contactIds).toEqual([c1.id]);
    expect(out.names).toEqual(['Zoé']);
    expect(reinviteCandidates(db, 'u2', o1)).toEqual({ contactIds: [], names: [] });
  });
});
