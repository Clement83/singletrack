import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Accept, Follow, Reject, Undo, type Actor } from '@fedify/vocab';
import type { Db } from '@/db';
import { contact, friendship, remoteActor, user } from '@/db/schema';
import { remotePairKey, removeFriendship, respondToRequest, type FriendResult } from '@/lib/friends';
import { federationEnabled, instanceDomain, publicOrigin } from './config';
import { getFederation } from './index';
import { getHandle, userIdByHandle } from './handle';
import { getRemoteActor, upsertRemoteActor } from './remote-actors';
import { allowFriendRequest, isActorBlocked, isDomainBlocked, logRefusal } from './moderation';

/**
 * Friends across servers (#1475, docs/federation.md §5). Friendship = **two accepted `Follow`s**; in the database, a single
 * `friendship` row (a local account + `remote_actor`): `pending` while a half is missing, `accepted` once both are in.
 *
 * - request → `Follow`; accept → `Accept(Follow)` **and** a `Follow` back (id `<follow>-back`); decline → `Reject(Follow)`;
 * - remove / cancel → `Undo(Follow)`; the receiver deletes the relation and sends the `Undo` of its own `Follow`;
 * - crossed request (both asked) = acceptance, as for local friends (#1432).
 * The logic here has no network: it describes the activities to send (`Outbound`) to an injectable `Deliver` (tests).
 */

export type Outbound =
  | { t: 'follow'; id: string }                      // my Follow (id of the URL `/ap/follows/<id>`), `<friendship>-back` for the one back
  | { t: 'accept'; followId: string }                // Accept of the received Follow (its URL)
  | { t: 'reject'; followId: string }
  | { t: 'undo'; followId: string };                 // Undo of my Follow
export type Deliver = (handle: string, to: typeof remoteActor.$inferSelect, msg: Outbound) => Promise<void>;

export const followUrl = (id: string) => `${publicOrigin()}/ap/follows/${id}`;
const FOLLOW_PATH = /\/ap\/follows\/([A-Za-z0-9-]+?)(-back)?$/;

/** `paul@mtb.example.org` (or `@paul@…`, `acct:paul@…`) → `{ handle, domain }`, otherwise null. */
export function parseAddress(input: unknown): { handle: string; domain: string } | null {
  if (typeof input !== 'string') return null;
  const m = /^(?:acct:)?@?([a-z0-9_]{1,64})@([a-z0-9.-]+(?::\d{1,5})?)$/i.exec(input.trim());
  return m ? { handle: m[1].toLowerCase(), domain: m[2].toLowerCase() } : null;
}

const accepted = (db: Db, id: string) => db.update(friendship).set({ status: 'accepted', respondedAt: new Date() }).where(eq(friendship.id, id)).run();

/** Friendship row between my account and this remote actor. */
const findRemote = (db: Db, userId: string, remoteActorId: string) =>
  db.select().from(friendship).where(eq(friendship.pairKey, remotePairKey(userId, remoteActorId))).get();

/** My `Follow` and my `Follow` back: which one depends on who asked. */
const myFollowId = (f: typeof friendship.$inferSelect, userId: string) => (f.requesterId === userId ? f.id : `${f.id}-back`);

// ───────────────────────── Outbound (action of my account) ─────────────────────────

export type ResolveActor = (address: { handle: string; domain: string }) => Promise<{ actorUrl: string; handle: string; displayName: string | null; inboxUrl: string; sharedInboxUrl: string | null } | null>;

async function devWebfinger(handle: string, domain: string): Promise<URL | null> {
  const r = await fetch(`http://${domain}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${handle}@${domain}`)}`, { headers: { accept: 'application/jrd+json' } }).catch(() => null);
  if (!r?.ok) return null;
  const href = ((await r.json().catch(() => null)) as { links?: { rel: string; href: string }[] } | null)?.links?.find((l) => l.rel === 'self')?.href;
  return href ? new URL(href) : null;
}

/** WebFinger + actor resolution through Fedify. Null if not found (network, 404, not an actor): never a visible error. */
export const resolveWithFedify: ResolveActor = async ({ handle, domain }) => {
  try {
    const ctx = getFederation().createContext(new URL(publicOrigin()), undefined);
    // Dev only (`FEDERATION_DEV_HTTP=1`): Fedify's WebFinger requires HTTPS, so it is done over HTTP and Fedify reads the actor.
    const target = process.env.FEDERATION_DEV_HTTP === '1' ? await devWebfinger(handle, domain) : `${handle}@${domain}`;
    if (!target) return null;
    const obj = await Promise.race([
      ctx.lookupObject(target),
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ]);
    const a = obj as Actor | null;
    if (!a || !('inboxId' in a) || !a.id || !a.inboxId) return null;
    return {
      actorUrl: a.id.href, handle: a.preferredUsername?.toString() ?? handle, displayName: a.name?.toString() ?? null,
      inboxUrl: a.inboxId.href, sharedInboxUrl: a.endpoints?.sharedInbox?.href ?? null,
    };
  } catch {
    return null;
  }
};

/** Delivery through the Fedify queue (retries over ~48 h). */
export const deliverWithFedify: Deliver = async (handle, to, msg) => {
  const ctx = getFederation().createContext(new URL(publicOrigin()), undefined);
  const me = ctx.getActorUri(handle);
  const target = new URL(to.actorUrl);
  const mkFollow = (id: string, actor: URL, object: URL) => new Follow({ id: new URL(followUrl(id)), actor, object });
  const recipient = { id: target, inboxId: new URL(to.inboxUrl), endpoints: to.sharedInboxUrl ? { sharedInbox: new URL(to.sharedInboxUrl) } : null };
  let activity;
  if (msg.t === 'follow') activity = mkFollow(msg.id, me, target);
  else if (msg.t === 'undo') activity = new Undo({ id: new URL(`${publicOrigin()}/ap/undo/${randomUUID()}`), actor: me, object: mkFollow(msg.followId, me, target) });
  else {
    const follow = new Follow({ id: new URL(msg.followId), actor: target, object: me });
    const C = msg.t === 'accept' ? Accept : Reject;
    activity = new C({ id: new URL(`${publicOrigin()}/ap/${msg.t}/${randomUUID()}`), actor: me, object: follow });
  }
  await ctx.sendActivity({ identifier: handle }, recipient, activity);
};

export type FedDeps = { resolve: ResolveActor; deliver: Deliver };
export const defaultDeps: FedDeps = { resolve: resolveWithFedify, deliver: deliverWithFedify };

async function safeDeliver(deps: FedDeps, db: Db, userId: string, remoteActorId: string, msg: Outbound) {
  const handle = getHandle(db, userId).handle;
  const to = db.select().from(remoteActor).where(eq(remoteActor.id, remoteActorId)).get();
  if (!handle || !to || !federationEnabled() || isDomainBlocked(db, to.domain)) return; // a blocked server receives nothing
  try { await deps.deliver(handle, to, msg); } catch (e) { console.warn('[federation] envoi copains', msg.t, e instanceof Error ? e.message : e); }
}

/**
 * Friend request by address `paul@server`. Address not found ⇒ same answer as for an unknown email (`ok`, nothing created).
 * An address on this server is handled locally (local friend, no network).
 */
export async function requestByAddress(db: Db, userId: string, input: unknown, deps: FedDeps = defaultDeps): Promise<FriendResult> {
  const addr = parseAddress(input);
  if (!addr) return { ok: false, error: 'invalidAddress' };
  if (!federationEnabled()) return { ok: false, error: 'federationOff' };
  if (addr.domain === instanceDomain().toLowerCase()) {
    const target = userIdByHandle(db, addr.handle);
    if (target === userId) return { ok: false, error: 'selfFriend' };
    if (!target) return { ok: true };
    const { requestByEmail } = await import('@/lib/friends');
    const email = db.select({ e: user.email }).from(user).where(eq(user.id, target)).get()?.e;
    return email ? requestByEmail(db, userId, email) : { ok: true };
  }
  if (isDomainBlocked(db, addr.domain)) return { ok: true }; // same answer as an address not found
  const found = await deps.resolve(addr);
  if (!found || isDomainBlocked(db, new URL(found.actorUrl).host)) return { ok: true };
  const actor = upsertRemoteActor(db, found);
  const existing = findRemote(db, userId, actor.id);
  if (!existing) {
    const id = randomUUID();
    db.insert(friendship).values({ id, requesterId: userId, addresseeId: null, remoteActorId: actor.id, pairKey: remotePairKey(userId, actor.id) }).run();
    await safeDeliver(deps, db, userId, actor.id, { t: 'follow', id });
  } else if (existing.status === 'pending' && existing.addresseeId === userId) {
    await acceptRemote(db, userId, existing, deps); // crossed request = acceptance
  }
  return { ok: true };
}

/** Accept a remote `Follow`: `Accept` + `Follow` back (friendship is mutual). */
async function acceptRemote(db: Db, userId: string, f: typeof friendship.$inferSelect, deps: FedDeps) {
  accepted(db, f.id);
  if (f.remoteFollowId) await safeDeliver(deps, db, userId, f.remoteActorId!, { t: 'accept', followId: f.remoteFollowId });
  await safeDeliver(deps, db, userId, f.remoteActorId!, { t: 'follow', id: `${f.id}-back` });
}

/** Answer to a received request (accept / decline), local or remote: sends the activities if needed. */
export async function respondFederated(db: Db, userId: string, id: string, action: unknown, deps: FedDeps = defaultDeps): Promise<FriendResult> {
  const f = db.select().from(friendship).where(eq(friendship.id, id)).get();
  const r = respondToRequest(db, userId, id, action);
  if (!r.ok || !r.remote || !f) return r.ok ? { ok: true } : r;
  const to = r.remote.remoteActorId;
  if (action === 'accept') {
    if (r.remote.followId) await safeDeliver(deps, db, userId, to, { t: 'accept', followId: r.remote.followId });
    await safeDeliver(deps, db, userId, to, { t: 'follow', id: `${f.id}-back` });
  } else if (r.remote.followId) {
    await safeDeliver(deps, db, userId, to, { t: 'reject', followId: r.remote.followId });
  }
  return { ok: true };
}

/** Remove a friend / cancel a request: `Undo(Follow)` to the other server. */
export async function removeFederated(db: Db, userId: string, id: string, deps: FedDeps = defaultDeps): Promise<FriendResult> {
  const f = db.select().from(friendship).where(eq(friendship.id, id)).get();
  const r = removeFriendship(db, userId, id);
  if (!r.ok || !r.remote || !f) return r.ok ? { ok: true } : r;
  // I only sent a Follow if I asked, or if I accepted (Follow back).
  if (f.requesterId === userId || r.remote.wasAccepted) await safeDeliver(deps, db, userId, r.remote.remoteActorId, { t: 'undo', followId: myFollowId(f, userId) });
  return { ok: true };
}

// ───────────────────────── Inbound (signed activities, verified by Fedify) ─────────────────────────

/** `Follow` received from a remote actor (already cached) targeting my account `handle`. */
export async function onFollow(db: Db, actorUrl: string, targetHandle: string, followId: string | null, deps: FedDeps = defaultDeps): Promise<void> {
  const actor = getRemoteActor(db, actorUrl);
  const userId = userIdByHandle(db, targetHandle);
  if (!actor || !userId) return;
  if (isDomainBlocked(db, actor.domain) || isActorBlocked(db, userId, actor.id)) return;
  const f = findRemote(db, userId, actor.id);
  if (!f) {
    if (!allowFriendRequest(db, userId, actor.domain)) { logRefusal(db, { domain: actor.domain, reason: 'friend_quota', activity: 'Follow' }); return; }
    db.insert(friendship).values({ requesterId: null, addresseeId: userId, remoteActorId: actor.id, remoteFollowId: followId, pairKey: remotePairKey(userId, actor.id) }).run();
    return;
  }
  if (followId && f.remoteFollowId !== followId) db.update(friendship).set({ remoteFollowId: followId }).where(eq(friendship.id, f.id)).run();
  const fresh = { ...f, remoteFollowId: followId ?? f.remoteFollowId };
  if (f.status === 'accepted') {
    // Follow back from a friend who just accepted, or a replay: confirm it.
    if (fresh.remoteFollowId) await safeDeliver(deps, db, userId, actor.id, { t: 'accept', followId: fresh.remoteFollowId });
  } else if (f.requesterId === userId) {
    // I had asked: crossed request = acceptance.
    accepted(db, f.id);
    if (fresh.remoteFollowId) await safeDeliver(deps, db, userId, actor.id, { t: 'accept', followId: fresh.remoteFollowId });
  }
}

/** URL of my `Follow` → friendship row I am the sender of. */
function myFriendshipForFollow(db: Db, followUrlStr: string | null, actorUrl: string) {
  const m = followUrlStr ? FOLLOW_PATH.exec(new URL(followUrlStr).pathname) : null;
  const actor = getRemoteActor(db, actorUrl);
  if (!m || !actor) return null;
  const f = db.select().from(friendship).where(and(eq(friendship.id, m[1]), eq(friendship.remoteActorId, actor.id))).get();
  return f ? { f, back: !!m[2] } : null;
}

/** `Accept(Follow)` from the remote actor: my `Follow` is accepted ⇒ friends (any Follow back is already in). */
export function onAccept(db: Db, actorUrl: string, followUrlStr: string | null): void {
  const hit = myFriendshipForFollow(db, followUrlStr, actorUrl);
  if (hit && !hit.back && hit.f.status === 'pending') accepted(db, hit.f.id);
}

/** `Reject(Follow)`: my request is declined, it disappears. */
export function onReject(db: Db, actorUrl: string, followUrlStr: string | null): void {
  const hit = myFriendshipForFollow(db, followUrlStr, actorUrl);
  if (hit && !hit.back && hit.f.status === 'pending') db.delete(friendship).where(eq(friendship.id, hit.f.id)).run();
}

/** `Undo(Follow)`: the other server removes the relation; I delete it and undo my own `Follow`. */
export async function onUndoFollow(db: Db, actorUrl: string, targetHandle: string, deps: FedDeps = defaultDeps): Promise<void> {
  const actor = getRemoteActor(db, actorUrl);
  const userId = userIdByHandle(db, targetHandle);
  if (!actor || !userId) return;
  const f = findRemote(db, userId, actor.id);
  if (!f) return;
  db.delete(friendship).where(eq(friendship.id, f.id)).run();
  db.update(contact).set({ remoteActorId: null }).where(and(eq(contact.ownerUserId, userId), eq(contact.remoteActorId, actor.id))).run();
  if (f.status === 'accepted' || f.requesterId === userId) await safeDeliver(deps, db, userId, actor.id, { t: 'undo', followId: myFollowId(f, userId) });
}

