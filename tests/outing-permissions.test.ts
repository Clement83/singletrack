import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { invitation, outing, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import {
  createInvitation, createOuting, duplicateOuting, getManagedOuting, getOwnedOuting, makePublic, outingPermissions, refreshSnapshot,
  revokeInvitation, setOpenLink, setStatus, updateOuting,
} from '@/lib/outings';
import { listFriends, requestByEmail, respondToRequest } from '@/lib/friends';
import { listVisibleOutings, joinVisibleOuting } from '@/lib/outings/open';
import { getDefaultOutingVisibility, setDefaultOutingVisibility } from '@/lib/user-profile';

// a = organiser, b = accepted friend, c = stranger, d = participant with an account, e = uninvited friend of a participant
async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id.toUpperCase(), email: `${id}@x.fr` }))).run();
  requestByEmail(db, 'b', 'a@x.fr');
  respondToRequest(db, 'a', listFriends(db, 'a').incoming[0].id, 'accept');
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 20] as [number, number, number]) }, raw: {},
  }, { enrich: false });
  const mk = async (owner: string, extra: object = {}) => {
    const r = await createOuting(db, owner, { trackSlug: t.slug, title: 'Sortie', date: '2030-05-10', time: '08:30', ...extra });
    if (!('slug' in r)) throw new Error('création');
    return r.slug;
  };
  const row = (slug: string) => db.select().from(outing).where(eq(outing.slug, slug)).get()!;
  return { db, mk, row };
}

describe('outingPermissions (#1455)', () => {
  it('privée « copains » : propriétaire, copain, inconnu, invité par lien, participant avec compte', async () => {
    const { db, mk, row } = await setup();
    const o = row(await mk('a', { visibility: 'friends' }));
    expect(o.ownerId).toBe('a');
    const owner = outingPermissions(db, { userId: 'a' }, o);
    expect(owner).toMatchObject({ isOwner: true, frozen: false, canView: true, canEdit: true, canCancel: true, canInvite: true, canInviteFriends: true, canShareGroupLink: true, canModerateComment: true, canJoin: false });
    const friend = outingPermissions(db, { userId: 'b' }, o);
    expect(friend).toMatchObject({ canView: true, canEdit: false, canCancel: false, canInvite: false, canInviteFriends: false, canShareGroupLink: false, canModerateComment: false, canJoin: true });
    const stranger = outingPermissions(db, { userId: 'c' }, o);
    expect(stranger).toMatchObject({ canView: false, canJoin: false, canInvite: false });
    expect(outingPermissions(db, {}, o).canView).toBe(false);
    // Guest through a link (no account): sees, does not edit, does not join "with an account".
    const inv = createInvitation(db, 'a', o.slug, 'Léo');
    if (!inv.ok) throw new Error('inv');
    const guestInv = db.select().from(invitation).where(eq(invitation.id, inv.id)).get()!;
    const guest = outingPermissions(db, { invitation: guestInv }, o);
    expect(guest).toMatchObject({ canView: true, canEdit: false, canInvite: false, canJoin: false, canModerateComment: false });
    expect(guest.canRevoke(guestInv)).toBe(false); // created by the organiser, not by them (#1457)
    expect(guest.canRevoke({ createdByUserId: null, createdByInvitationId: guestInv.id })).toBe(true); // a link they created
    expect(owner.canRevoke({ createdByUserId: null, createdByInvitationId: null })).toBe(true);
    // Participant with an account: sees even without being a friend.
    expect(joinVisibleOuting(db, 'b', o.id)).toMatchObject({ ok: true });
    db.insert(invitation).values({ outingId: o.id, tokenHash: 'h', name: 'D', userId: 'd', status: 'yes' }).run();
    const participant = outingPermissions(db, { userId: 'd' }, o);
    expect(participant).toMatchObject({ isParticipant: true, canView: true, canEdit: false, canInvite: false });
  });

  it('privée « sur invitation » : copain non invité ne voit pas', async () => {
    const { db, mk, row } = await setup();
    const o = row(await mk('a', { visibility: 'invite' }));
    expect(outingPermissions(db, { userId: 'b' }, o)).toMatchObject({ canView: false, canJoin: false });
    expect(outingPermissions(db, { userId: 'a' }, o).canView).toBe(true);
  });

  it('option « les participants invitent » : seuls les participants inscrits (yes) gagnent canInvite', async () => {
    const { db, mk, row } = await setup();
    const slug = await mk('a', { visibility: 'invite', participantsCanInvite: true });
    const o = row(slug);
    expect(o.participantsCanInvite).toBe(true);
    db.insert(invitation).values([
      { outingId: o.id, tokenHash: 'h1', name: 'D', userId: 'd', status: 'yes' },
      { outingId: o.id, tokenHash: 'h2', name: 'E', userId: 'e', status: 'maybe' },
    ]).run();
    expect(outingPermissions(db, { userId: 'd' }, o)).toMatchObject({ canInvite: true, canInviteFriends: true, canShareGroupLink: true, canEdit: false });
    expect(outingPermissions(db, { userId: 'e' }, o)).toMatchObject({ canInvite: false });
    // A link guest without an account can invite, but not "their friends" (they have none).
    const link = db.select().from(invitation).where(eq(invitation.tokenHash, 'h1')).get()!;
    expect(outingPermissions(db, { invitation: { ...link, userId: null } }, o)).toMatchObject({ canInvite: true, canInviteFriends: false });
    // Option off (default): nobody but the owner.
    const o2 = row(await mk('a', { visibility: 'invite', title: 'Sans option' }));
    expect(o2.participantsCanInvite).toBe(false);
  });

  it('publique : sans propriétaire, figée, mêmes droits pour tout compte, créateur compris', async () => {
    const { db, mk, row } = await setup();
    const slug = await mk('a', { visibility: 'public' });
    const o = row(slug);
    expect(o).toMatchObject({ ownerId: null, createdBy: 'a', openLinkEnabled: true, participantsCanInvite: true, visibility: 'public' });
    for (const uid of ['a', 'b', 'c']) {
      expect(outingPermissions(db, { userId: uid }, o)).toMatchObject({
        isOwner: false, frozen: true, canView: true, canEdit: false, canCancel: false, canInvite: true, canInviteFriends: true,
        canShareGroupLink: true, canModerateComment: false,
      });
    }
    expect(outingPermissions(db, { userId: 'c' }, o).canJoin).toBe(true);
    expect(outingPermissions(db, {}, o)).toMatchObject({ canView: false, canInvite: false }); // anonymous without a link
    expect(getOwnedOuting(db, 'a', slug)).toBeUndefined();
    expect(getManagedOuting(db, 'a', slug)?.slug).toBe(slug); // its creator keeps their page
    expect(getManagedOuting(db, 'c', slug)).toBeUndefined();
  });

  it('publique : modifier / annuler / actualiser / lien de groupe refusés (outingFrozen), inconnu = not_found', async () => {
    const { db, mk, row } = await setup();
    const slug = await mk('a', { visibility: 'public' });
    expect(updateOuting(db, 'a', slug, { title: 'X' })).toEqual({ ok: false, error: 'outingFrozen' });
    expect(setStatus(db, 'a', slug, 'cancelled')).toEqual({ ok: false, error: 'outingFrozen' });
    expect(refreshSnapshot(db, 'a', slug)).toEqual({ ok: false, error: 'outingFrozen' });
    expect(setOpenLink(db, 'a', slug, false)).toEqual({ ok: false, error: 'outingFrozen' });
    expect(updateOuting(db, 'c', slug, { title: 'X' })).toEqual({ ok: false, error: 'not_found' });
    // The creator can invite and revoke their own links; a third party cannot.
    const inv = createInvitation(db, 'a', slug, 'Léo');
    expect(inv.ok).toBe(true);
    expect(createInvitation(db, 'c', slug, 'Zoé')).toEqual({ ok: false, error: 'not_found' });
    // Revocation limited to the links one created (#1457): a link created by another account cannot be touched.
    db.insert(invitation).values({ outingId: row(slug).id, tokenHash: 'z1', name: 'Zoé', createdByUserId: 'c' }).run();
    const other = db.select().from(invitation).where(eq(invitation.tokenHash, 'z1')).get()!;
    expect(revokeInvitation(db, 'a', slug, other.id)).toEqual({ ok: false, error: 'not_found' });
    if (inv.ok) expect(revokeInvitation(db, 'a', slug, inv.id).ok).toBe(true);
  });

  it('makePublic : propriétaire seulement, figé ensuite, jamais l’inverse', async () => {
    const { db, mk, row } = await setup();
    const slug = await mk('a', { visibility: 'invite' });
    expect(makePublic(db, 'b', slug)).toEqual({ ok: false, error: 'not_found' });
    expect(row(slug).ownerId).toBe('a');
    expect(makePublic(db, 'a', slug)).toEqual({ ok: true });
    expect(row(slug)).toMatchObject({ visibility: 'public', ownerId: null, createdBy: 'a', openLinkEnabled: true, participantsCanInvite: true });
    expect(makePublic(db, 'a', slug)).toEqual({ ok: false, error: 'not_found' }); // no owner any more
    expect(updateOuting(db, 'a', slug, { visibility: 'friends' })).toEqual({ ok: false, error: 'outingFrozen' });
  });

  it('privée → publique par updateOuting refusé ; participantsCanInvite modifiable ; la duplication d’une publique reste publique', async () => {
    const { db, mk, row } = await setup();
    const slug = await mk('a', { visibility: 'friends' });
    expect(updateOuting(db, 'a', slug, { visibility: 'public' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(updateOuting(db, 'a', slug, { participantsCanInvite: true })).toEqual({ ok: true });
    expect(row(slug).participantsCanInvite).toBe(true);
    const pub = await mk('a', { visibility: 'public', title: 'P' });
    const d = duplicateOuting(db, 'a', pub, { date: '2030-06-01', time: '09:00' });
    if (!d.ok) throw new Error('dup');
    expect(row(d.slug)).toMatchObject({ visibility: 'public', ownerId: null, openLinkEnabled: true });
  });

  it('défaut du compte : copains ; « public » refusé comme défaut', async () => {
    const { db } = await setup();
    expect(getDefaultOutingVisibility(db, 'c')).toBe('friends');
    expect(setDefaultOutingVisibility(db, 'c', 'public')).toEqual({ ok: false, error: 'invalid' });
  });

  it('sorties ouvertes : une publique est proposée à tout compte, jamais à son créateur', async () => {
    const { db, mk } = await setup();
    await mk('a', { visibility: 'public' });
    expect(listVisibleOutings(db, 'c', new Date('2030-01-01')).map((o) => o.visibility)).toEqual(['public']);
    expect(listVisibleOutings(db, 'a', new Date('2030-01-01'))).toEqual([]);
  });
});
