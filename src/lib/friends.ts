import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from '@/db';
import { contact, friendInvite, friendship, invitation, remoteActor, user } from '@/db/schema';
import { getInvitationByToken } from '@/lib/outings/service';
import { hashToken, newToken } from '@/lib/outings/tokens';

/**
 * Copains (#1432) : relation d'amitié entre comptes. Pas d'annuaire : on ne trouve quelqu'un que par son
 * email exact, ou par un lien à usage unique. Un email inconnu et un email connu donnent la même réponse.
 */

export type FriendResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);
/** Clé de paire d'un copain d'un autre serveur (#1475) : un compte local et un acteur distant. */
export const remotePairKey = (userId: string, remoteActorId: string) => `${userId}:r:${remoteActorId}`;

const findPair = (db: Db, a: string, b: string) =>
  db.select().from(friendship).where(eq(friendship.pairKey, pairKey(a, b))).get();

/** Retire le lien carnet ↔ compte des deux côtés quand l'amitié disparaît (`b` NULL : copain distant `remoteActorId`). */
function unlinkContacts(db: Db, a: string | null, b: string | null, remoteActorId: string | null = null) {
  if (a && b) {
    db.update(contact).set({ userId: null }).where(and(eq(contact.ownerUserId, a), eq(contact.userId, b))).run();
    db.update(contact).set({ userId: null }).where(and(eq(contact.ownerUserId, b), eq(contact.userId, a))).run();
  } else if (remoteActorId) {
    db.update(contact).set({ remoteActorId: null }).where(and(eq(contact.ownerUserId, a ?? b ?? ''), eq(contact.remoteActorId, remoteActorId))).run();
  }
}

/**
 * Demande par email. Réponse identique que le compte existe ou non (pas d'énumération des comptes).
 * Si l'autre personne m'avait déjà demandé, la demande croisée vaut acceptation.
 */
export function requestByEmail(db: Db, userId: string, emailInput: unknown): FriendResult {
  const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'invalidEmail' };
  const target = db.select().from(user).where(eq(user.email, email)).get();
  if (target && target.id === userId) return { ok: false, error: 'selfFriend' };
  if (!target) return { ok: true };
  const existing = findPair(db, userId, target.id);
  if (!existing) {
    db.insert(friendship).values({ requesterId: userId, addresseeId: target.id, pairKey: pairKey(userId, target.id) }).run();
  } else if (existing.status === 'pending' && existing.addresseeId === userId) {
    db.update(friendship).set({ status: 'accepted', respondedAt: new Date() }).where(eq(friendship.id, existing.id)).run();
  }
  return { ok: true };
}

/** Crée un lien à usage unique ; le token en clair n'est renvoyé qu'ici. */
export function createInviteLink(db: Db, userId: string): { token: string; path: string } {
  const token = newToken();
  db.insert(friendInvite).values({ inviterId: userId, tokenHash: hashToken(token) }).run();
  return { token, path: `/copains/invitation/${token}` };
}

/** Prénom de l'inviteur d'un lien encore valide (pour l'écran d'acceptation), sinon null. */
export function peekInvite(db: Db, token: string): { inviterName: string } | null {
  const row = db.select({ name: user.name, usedAt: friendInvite.usedAt }).from(friendInvite)
    .innerJoin(user, eq(user.id, friendInvite.inviterId)).where(eq(friendInvite.tokenHash, hashToken(token))).get();
  return row && !row.usedAt ? { inviterName: row.name } : null;
}

/** Utilise un lien : copains immédiatement (le lien vaut accord de l'inviteur). Usage unique. */
export function redeemInvite(db: Db, userId: string, token: string): FriendResult<{ friendId: string }> {
  const inv = db.select().from(friendInvite).where(eq(friendInvite.tokenHash, hashToken(token))).get();
  if (!inv || inv.usedAt) return { ok: false, error: 'not_found' };
  if (inv.inviterId === userId) return { ok: false, error: 'selfFriend' };
  return db.transaction((tx) => {
    const done = tx.update(friendInvite).set({ usedAt: new Date(), usedBy: userId })
      .where(and(eq(friendInvite.id, inv.id), eq(friendInvite.tokenHash, inv.tokenHash))).run();
    if (!done.changes) return { ok: false as const, error: 'not_found' };
    const existing = findPair(tx as unknown as Db, userId, inv.inviterId);
    if (!existing) {
      tx.insert(friendship).values({
        requesterId: inv.inviterId, addresseeId: userId, pairKey: pairKey(userId, inv.inviterId), status: 'accepted', respondedAt: new Date(),
      }).run();
    } else if (existing.status === 'pending') {
      tx.update(friendship).set({ status: 'accepted', respondedAt: new Date() }).where(eq(friendship.id, existing.id)).run();
    }
    return { ok: true as const, friendId: inv.inviterId };
  });
}

/** Copain d'un autre serveur concerné par une réponse ou un retrait : l'appelant (asynchrone) lui envoie l'activité. */
export type RemoteSide = { remoteActorId: string; followId: string | null; wasAccepted: boolean };
const remoteSide = (f: { remoteActorId: string | null; remoteFollowId: string | null; status: string }): RemoteSide | undefined =>
  f.remoteActorId ? { remoteActorId: f.remoteActorId, followId: f.remoteFollowId, wasAccepted: f.status === 'accepted' } : undefined;

/** Seul le destinataire répond : accepter, ou refuser (la demande disparaît, sans trace pour le demandeur). */
export function respondToRequest(db: Db, userId: string, id: string, action: unknown): FriendResult<{ remote?: RemoteSide }> {
  if (action !== 'accept' && action !== 'decline') return { ok: false, error: 'invalid' };
  const f = db.select().from(friendship)
    .where(and(eq(friendship.id, id), eq(friendship.addresseeId, userId), eq(friendship.status, 'pending'))).get();
  if (!f) return { ok: false, error: 'not_found' };
  if (action === 'accept') db.update(friendship).set({ status: 'accepted', respondedAt: new Date() }).where(eq(friendship.id, id)).run();
  else db.delete(friendship).where(eq(friendship.id, id)).run();
  return { ok: true, remote: remoteSide(f) };
}

/** Retire un copain ou annule une demande envoyée (l'un ou l'autre des deux comptes). */
export function removeFriendship(db: Db, userId: string, id: string): FriendResult<{ remote?: RemoteSide }> {
  const f = db.select().from(friendship)
    .where(and(eq(friendship.id, id), or(eq(friendship.requesterId, userId), eq(friendship.addresseeId, userId)))).get();
  if (!f) return { ok: false, error: 'not_found' };
  db.delete(friendship).where(eq(friendship.id, id)).run();
  unlinkContacts(db, f.requesterId, f.addresseeId, f.remoteActorId);
  return { ok: true, remote: remoteSide(f) };
}

/** `userId` NULL = copain d'un autre serveur : `remote` donne son adresse (jamais d'email) et son profil sur son serveur. */
export type FriendEntry = {
  id: string; userId: string | null; name: string;
  remote?: { actorId: string; handle: string; domain: string; profileUrl: string };
};
export type FriendsView = { friends: FriendEntry[]; incoming: FriendEntry[]; outgoing: FriendEntry[] };

/** Mes copains et mes demandes, locaux ou d'un autre serveur (une seule notion). Seul le prénom de l'autre est exposé, jamais son email. */
export function listFriends(db: Db, userId: string): FriendsView {
  const rows = db.select().from(friendship)
    .where(or(eq(friendship.requesterId, userId), eq(friendship.addresseeId, userId))).all();
  const names = new Map(db.select({ id: user.id, name: user.name }).from(user).all().map((u) => [u.id, u.name]));
  const actors = new Map(db.select().from(remoteActor).all().map((a) => [a.id, a]));
  const view: FriendsView = { friends: [], incoming: [], outgoing: [] };
  for (const r of rows) {
    let e: FriendEntry;
    if (r.remoteActorId) {
      const a = actors.get(r.remoteActorId);
      if (!a) continue;
      e = { id: r.id, userId: null, name: a.displayName || a.handle, remote: { actorId: a.id, handle: a.handle, domain: a.domain, profileUrl: a.actorUrl } };
    } else {
      const other = (r.requesterId === userId ? r.addresseeId : r.requesterId) ?? '';
      e = { id: r.id, userId: other, name: names.get(other) ?? '' };
    }
    if (r.status === 'accepted') view.friends.push(e);
    else (r.addresseeId === userId ? view.incoming : view.outgoing).push(e);
  }
  const byName = (a: FriendEntry, b: FriendEntry) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  view.friends.sort(byName);
  return view;
}

/** Acteurs distants dont je suis copain accepté (pour P6 : sorties « copains » reçues de leur serveur). */
export const remoteFriendActorIds = (db: Db, userId: string): string[] =>
  db.select({ r: friendship.remoteActorId }).from(friendship)
    .where(and(eq(friendship.status, 'accepted'), or(eq(friendship.requesterId, userId), eq(friendship.addresseeId, userId)))).all()
    .flatMap((x) => (x.r ? [x.r] : []));

/** Copain distant accepté, retrouvé par son URL d'acteur (P6 : droit de voir ma sortie « copains »). */
export const isRemoteFriend = (db: Db, userId: string, actorUrl: string): boolean => {
  const a = db.select({ id: remoteActor.id }).from(remoteActor).where(eq(remoteActor.actorUrl, actorUrl)).get();
  return !!a && remoteFriendActorIds(db, userId).includes(a.id);
};

export const areFriends = (db: Db, a: string, b: string) => findPair(db, a, b)?.status === 'accepted';

/**
 * Lie (ou délie avec `null`) un pote du carnet à un copain accepté. Un compte ne lie qu'un pote par carnet.
 * Copain d'un autre serveur : `remoteActorId` (exclusif avec `friendUserId`).
 */
export function linkContact(db: Db, ownerId: string, contactId: string, friendUserId: unknown, remoteActorId?: unknown): FriendResult {
  const c = db.select().from(contact).where(and(eq(contact.id, contactId), eq(contact.ownerUserId, ownerId))).get();
  if (!c) return { ok: false, error: 'not_found' };
  if (friendUserId === null && remoteActorId == null) {
    db.update(contact).set({ userId: null, remoteActorId: null }).where(eq(contact.id, contactId)).run();
    return { ok: true };
  }
  if (typeof remoteActorId === 'string') {
    if (!remoteFriendActorIds(db, ownerId).includes(remoteActorId)) return { ok: false, error: 'notFriend' };
    const dup = db.select().from(contact).where(and(eq(contact.ownerUserId, ownerId), eq(contact.remoteActorId, remoteActorId))).get();
    if (dup && dup.id !== contactId) return { ok: false, error: 'alreadyLinked' };
    db.update(contact).set({ userId: null, remoteActorId }).where(eq(contact.id, contactId)).run();
    return { ok: true };
  }
  if (typeof friendUserId !== 'string' || !areFriends(db, ownerId, friendUserId)) return { ok: false, error: 'notFriend' };
  const dup = db.select().from(contact).where(and(eq(contact.ownerUserId, ownerId), eq(contact.userId, friendUserId))).get();
  if (dup && dup.id !== contactId) return { ok: false, error: 'alreadyLinked' };
  db.update(contact).set({ userId: friendUserId, remoteActorId: null }).where(eq(contact.id, contactId)).run();
  return { ok: true };
}

/**
 * Rattacher un invité à son compte (#1434). Le lien perso reste la seule preuve : qui l'a en main peut le rattacher.
 * Décision : acceptation implicite — l'organisateur a créé ce lien nominatif pour cette personne (accord de sa part) et
 * l'invité demande lui-même le rattachement (accord de la sienne) : ils deviennent copains tout de suite, sans demande à accepter.
 * Le pote du carnet lié à l'invitation est aussi lié au compte s'il ne l'est pas déjà.
 */
export function claimInvitation(db: Db, userId: string, token: string): FriendResult<{ organizerId: string | null }> {
  const found = getInvitationByToken(db, token);
  if (!found) return { ok: false, error: 'not_found' };
  const { invitation: inv, outing: o } = found;
  if (o.ownerId && o.ownerId === userId) return { ok: false, error: 'selfFriend' };
  if (inv.userId) return { ok: false, error: inv.userId === userId ? 'alreadyClaimedByYou' : 'alreadyClaimed' };
  const other = db.select({ id: invitation.id }).from(invitation)
    .where(and(eq(invitation.outingId, inv.outingId), eq(invitation.userId, userId))).get();
  if (other) return { ok: false, error: 'alreadyOnOuting' };
  return db.transaction((tx) => {
    // Condition `user_id IS NULL` : deux rattachements simultanés, un seul passe.
    const done = tx.update(invitation).set({ userId, updatedAt: new Date() })
      .where(and(eq(invitation.id, inv.id), isNull(invitation.userId))).run();
    if (!done.changes) return { ok: false as const, error: 'alreadyClaimed' };
    const org = o.ownerId; // publique : pas d'organisateur, donc pas de copain créé
    if (org) {
      const existing = findPair(tx as unknown as Db, userId, org);
      if (!existing) {
        tx.insert(friendship).values({ requesterId: org, addresseeId: userId, pairKey: pairKey(userId, org), status: 'accepted', respondedAt: new Date() }).run();
      } else if (existing.status === 'pending') {
        tx.update(friendship).set({ status: 'accepted', respondedAt: new Date() }).where(eq(friendship.id, existing.id)).run();
      }
      if (inv.contactId) {
        const already = tx.select({ id: contact.id }).from(contact).where(and(eq(contact.ownerUserId, org), eq(contact.userId, userId))).get();
        if (!already) tx.update(contact).set({ userId }).where(and(eq(contact.id, inv.contactId), isNull(contact.userId))).run();
      }
    }
    return { ok: true as const, organizerId: org ?? null };
  });
}
