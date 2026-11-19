import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from '@/db';
import { contact, friendInvite, friendship, invitation, remoteActor, user } from '@/db/schema';
import { getInvitationByToken } from '@/lib/outings/service';
import { hashToken, newToken } from '@/lib/outings/tokens';

/**
 * Friends (#1432): friendship relation between accounts. No directory: someone can only be found by their
 * exact email, or through a single-use link. An unknown and a known email give the same answer.
 */

export type FriendResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);
/** Pair key of a friend on another server (#1475): a local account and a remote actor. */
export const remotePairKey = (userId: string, remoteActorId: string) => `${userId}:r:${remoteActorId}`;

const findPair = (db: Db, a: string, b: string) =>
  db.select().from(friendship).where(eq(friendship.pairKey, pairKey(a, b))).get();

/** Removes the buddy book ↔ account link on both sides when the friendship disappears (`b` NULL: remote friend `remoteActorId`). */
function unlinkContacts(db: Db, a: string | null, b: string | null, remoteActorId: string | null = null) {
  if (a && b) {
    db.update(contact).set({ userId: null }).where(and(eq(contact.ownerUserId, a), eq(contact.userId, b))).run();
    db.update(contact).set({ userId: null }).where(and(eq(contact.ownerUserId, b), eq(contact.userId, a))).run();
  } else if (remoteActorId) {
    db.update(contact).set({ remoteActorId: null }).where(and(eq(contact.ownerUserId, a ?? b ?? ''), eq(contact.remoteActorId, remoteActorId))).run();
  }
}

/**
 * Request by email. Same answer whether the account exists or not (no account enumeration).
 * If the other person had already asked me, the crossed request counts as acceptance.
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

/** Creates a single-use link; the plain token is only returned here. */
export function createInviteLink(db: Db, userId: string): { token: string; path: string } {
  const token = newToken();
  db.insert(friendInvite).values({ inviterId: userId, tokenHash: hashToken(token) }).run();
  return { token, path: `/copains/invitation/${token}` };
}

/** First name of the inviter of a still-valid link (for the acceptance screen), otherwise null. */
export function peekInvite(db: Db, token: string): { inviterName: string } | null {
  const row = db.select({ name: user.name, usedAt: friendInvite.usedAt }).from(friendInvite)
    .innerJoin(user, eq(user.id, friendInvite.inviterId)).where(eq(friendInvite.tokenHash, hashToken(token))).get();
  return row && !row.usedAt ? { inviterName: row.name } : null;
}

/** Uses a link: friends immediately (the link counts as the inviter's agreement). Single use. */
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

/** Friend on another server concerned by an answer or a removal: the (asynchronous) caller sends them the activity. */
export type RemoteSide = { remoteActorId: string; followId: string | null; wasAccepted: boolean };
const remoteSide = (f: { remoteActorId: string | null; remoteFollowId: string | null; status: string }): RemoteSide | undefined =>
  f.remoteActorId ? { remoteActorId: f.remoteActorId, followId: f.remoteFollowId, wasAccepted: f.status === 'accepted' } : undefined;

/** Only the recipient answers: accept, or decline (the request disappears, without a trace for the requester). */
export function respondToRequest(db: Db, userId: string, id: string, action: unknown): FriendResult<{ remote?: RemoteSide }> {
  if (action !== 'accept' && action !== 'decline') return { ok: false, error: 'invalid' };
  const f = db.select().from(friendship)
    .where(and(eq(friendship.id, id), eq(friendship.addresseeId, userId), eq(friendship.status, 'pending'))).get();
  if (!f) return { ok: false, error: 'not_found' };
  if (action === 'accept') db.update(friendship).set({ status: 'accepted', respondedAt: new Date() }).where(eq(friendship.id, id)).run();
  else db.delete(friendship).where(eq(friendship.id, id)).run();
  return { ok: true, remote: remoteSide(f) };
}

/** Removes a friend or cancels a sent request (either of the two accounts). */
export function removeFriendship(db: Db, userId: string, id: string): FriendResult<{ remote?: RemoteSide }> {
  const f = db.select().from(friendship)
    .where(and(eq(friendship.id, id), or(eq(friendship.requesterId, userId), eq(friendship.addresseeId, userId)))).get();
  if (!f) return { ok: false, error: 'not_found' };
  db.delete(friendship).where(eq(friendship.id, id)).run();
  unlinkContacts(db, f.requesterId, f.addresseeId, f.remoteActorId);
  return { ok: true, remote: remoteSide(f) };
}

/** `userId` NULL = friend on another server: `remote` gives their address (never an email) and their profile on their server. */
export type FriendEntry = {
  id: string; userId: string | null; name: string;
  remote?: { actorId: string; handle: string; domain: string; profileUrl: string };
};
export type FriendsView = { friends: FriendEntry[]; incoming: FriendEntry[]; outgoing: FriendEntry[] };

/** My friends and my requests, local or on another server (a single notion). Only the other's first name is exposed, never their email. */
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

/** Remote actors I am an accepted friend of (for P6: "friends" outings received from their server). */
export const remoteFriendActorIds = (db: Db, userId: string): string[] =>
  db.select({ r: friendship.remoteActorId }).from(friendship)
    .where(and(eq(friendship.status, 'accepted'), or(eq(friendship.requesterId, userId), eq(friendship.addresseeId, userId)))).all()
    .flatMap((x) => (x.r ? [x.r] : []));

/** Accepted remote friend, found by their actor URL (P6: right to see my "friends" outing). */
export const isRemoteFriend = (db: Db, userId: string, actorUrl: string): boolean => {
  const a = db.select({ id: remoteActor.id }).from(remoteActor).where(eq(remoteActor.actorUrl, actorUrl)).get();
  return !!a && remoteFriendActorIds(db, userId).includes(a.id);
};

export const areFriends = (db: Db, a: string, b: string) => findPair(db, a, b)?.status === 'accepted';

/**
 * Links (or unlinks with `null`) a buddy-book entry to an accepted friend. An account links only one entry per book.
 * Friend on another server: `remoteActorId` (exclusive with `friendUserId`).
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
 * Attach a guest to their account (#1434). The personal link stays the only proof: whoever holds it can attach it.
 * Decision: implicit acceptance — the organiser created this named link for this person (their agreement) and
 * the guest asks for the attachment themselves (theirs): they become friends straight away, without a request to accept.
 * The buddy-book entry linked to the invitation is also linked to the account if it is not already.
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
    // `user_id IS NULL` condition: two simultaneous attachments, only one goes through.
    const done = tx.update(invitation).set({ userId, updatedAt: new Date() })
      .where(and(eq(invitation.id, inv.id), isNull(invitation.userId))).run();
    if (!done.changes) return { ok: false as const, error: 'alreadyClaimed' };
    const org = o.ownerId; // public: no organiser, so no friend created
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
