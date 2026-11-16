import { describe, it, expect } from 'vitest';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import {
  createContact, createOuting, getInvitationByToken, inviteMany, listContacts, listInvitations, getOwnedOuting, revokeInvitation, updateContact,
} from '@/lib/outings';

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([{ id: 'u1', name: 'Orga', email: 'o@x.fr' }, { id: 'u2', name: 'Autre', email: 'a@x.fr' }]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: [[6.1, 43.2, 100], [6.11, 43.21, 180], [6.1, 43.2, 101]] }, raw: {},
  }, { enrich: false });
  const mk = async (date: string) => {
    const o = await createOuting(db, 'u1', { trackSlug: t.slug, title: 'Dim', date, time: '08:30' });
    if (!('slug' in o)) throw new Error('création');
    return o.slug;
  };
  return { db, mk };
}

describe('carnet de potes', () => {
  it('3 contacts invités en une action : 3 liens distincts, nominatifs, fonctionnels', async () => {
    const { db, mk } = await setup();
    const slug = await mk('2099-05-10');
    const ids = ['Julien', 'Marc', 'Seb'].map((name) => { const r = createContact(db, 'u1', { name }); if (!r.ok) throw new Error(); return r.id; });
    const r = inviteMany(db, 'u1', slug, { contactIds: ids });
    if (!r.ok) throw new Error('invite');
    expect(r.invites.map((i) => i.name).sort()).toEqual(['Julien', 'Marc', 'Seb']);
    expect(new Set(r.invites.map((i) => i.token)).size).toBe(3);
    for (const i of r.invites) expect(getInvitationByToken(db, i.token)?.invitation.name).toBe(i.name);
    expect(listInvitations(db, getOwnedOuting(db, 'u1', slug)!.id).every((i) => i.contactId)).toBe(true);
  });

  it('un contact déjà invité (lien actif) est ignoré, un lien révoqué permet de réinviter', async () => {
    const { db, mk } = await setup();
    const slug = await mk('2099-05-10');
    const c = createContact(db, 'u1', { name: 'Julien' });
    if (!c.ok) throw new Error();
    const first = inviteMany(db, 'u1', slug, { contactIds: [c.id] });
    const again = inviteMany(db, 'u1', slug, { contactIds: [c.id] });
    expect(again.ok && again.invites.length).toBe(0);
    expect(again.ok && again.skipped).toEqual(['Julien']);
    if (!first.ok) throw new Error();
    revokeInvitation(db, 'u1', slug, first.invites[0].id);
    const third = inviteMany(db, 'u1', slug, { contactIds: [c.id] });
    expect(third.ok && third.invites.length).toBe(1);
  });

  it('nouveau nom : ajouté au carnet par défaut, sans doublon, ou non mémorisé', async () => {
    const { db, mk } = await setup();
    const slug = await mk('2099-05-10');
    inviteMany(db, 'u1', slug, { newNames: [{ name: 'Léa', addToBook: true }, { name: 'Anonyme', addToBook: false }] });
    expect(listContacts(db, 'u1').map((c) => c.name)).toEqual(['Léa']);
    const slug2 = await mk('2099-06-10');
    inviteMany(db, 'u1', slug2, { newNames: [{ name: ' léa ', addToBook: true }] });
    expect(listContacts(db, 'u1')).toHaveLength(1);
    expect(listContacts(db, 'u1')[0].outings).toBe(2);
  });

  it('tri par dernière invitation, historique, archivage sans perte', async () => {
    const { db, mk } = await setup();
    const a = createContact(db, 'u1', { name: 'Ana' });
    const b = createContact(db, 'u1', { name: 'Ben' });
    if (!a.ok || !b.ok) throw new Error();
    expect(listContacts(db, 'u1').map((c) => c.name)).toEqual(['Ana', 'Ben']);
    inviteMany(db, 'u1', await mk('2099-05-10'), { contactIds: [b.id] });
    expect(listContacts(db, 'u1').map((c) => c.name)).toEqual(['Ben', 'Ana']);
    expect(updateContact(db, 'u1', b.id, { archived: true }).ok).toBe(true);
    expect(listContacts(db, 'u1').map((c) => c.name)).toEqual(['Ana']);
    const arch = listContacts(db, 'u1', { archived: true });
    expect(arch[0]).toMatchObject({ name: 'Ben', outings: 1 });
    // archivé : absent de la sélection côté serveur aussi
    const slug = await mk('2099-07-01');
    const r = inviteMany(db, 'u1', slug, { contactIds: [b.id, a.id] });
    expect(r.ok && r.invites.map((i) => i.name)).toEqual(['Ana']);
  });

  it('isolation entre utilisateurs, validations', async () => {
    const { db, mk } = await setup();
    const c = createContact(db, 'u1', { name: 'Julien' });
    if (!c.ok) throw new Error();
    expect(updateContact(db, 'u2', c.id, { name: 'Pirate' })).toEqual({ ok: false, error: 'not_found' });
    expect(listContacts(db, 'u2')).toEqual([]);
    const slug = await mk('2099-05-10');
    expect(inviteMany(db, 'u2', slug, { contactIds: [c.id] })).toEqual({ ok: false, error: 'not_found' });
    expect(createContact(db, 'u1', { name: '  ' }).ok).toBe(false);
    expect(inviteMany(db, 'u1', slug, {}).ok).toBe(false);
    expect(updateContact(db, 'u1', c.id, { name: 'Jul', note: 'VAE' }).ok).toBe(true);
    expect(listContacts(db, 'u1')[0]).toMatchObject({ name: 'Jul', note: 'VAE' });
  });
});
