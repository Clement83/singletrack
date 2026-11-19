import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { count, eq, isNotNull } from 'drizzle-orm';
import { createExponentialBackoffPolicy, createFederation, type Federation } from '@fedify/fedify';
import { Accept, Activity, Create, Delete, Endpoints, Event, Follow, Join, Leave, Person, PUBLIC_COLLECTION, Reject, TentativeAccept, Undo, Update } from '@fedify/vocab';
import { SqliteKvStore, SqliteMessageQueue } from '@fedify/sqlite';
import { getDb } from '@/db';
import { outing, user } from '@/db/schema';
import { publicOrigin } from './config';
import { userIdByHandle } from './handle';
import { getUserKeyPair, publicKeyPem } from './keys';
import { upsertRemoteActor } from './remote-actors';
import { isDomainBlocked, LIMITS, logRefusal, pruneRemoteOutings } from './moderation';
import { onAccept, onFollow, onReject, onUndoFollow } from './friends';
import { buildEvent, eventData, onDeleteEvent, onEvent, onJoinResult, onRemoteResponse, parseEvent } from './outings';

/**
 * ActivityPub federation (#1474, docs/federation.md). Fedify; KV and persistent delivery queue in a separate SQLite
 * file (`FEDERATION_DB`, default `data/federation.db`). Exponential retries over ~48 h: a NAS that is switched off gets
 * its messages when it comes back. Actor id = handle; the actor URL is `<public origin>/ap/users/<handle>`.
 */
export const ACTOR_PATH = '/ap/users/{identifier}';
export const INBOX_PATH = '/ap/users/{identifier}/inbox';
export const SHARED_INBOX_PATH = '/ap/inbox';

/** ~48 h: 1 min, 2, 4… 4 h 16, then 8 h, 14 retries in all (jitter on). */
export const retryPolicy = createExponentialBackoffPolicy({ initialDelay: { minutes: 1 }, maxDelay: { hours: 8 }, factor: 2, maxAttempts: 14 });

type G = typeof globalThis & { __singletrackFederation?: Federation<void> };

/** Singleton on `globalThis`: Next recreates the modules on every hot reload (spike pitfall). */
export function getFederation(): Federation<void> {
  const g = globalThis as G;
  g.__singletrackFederation ??= buildFederation();
  return g.__singletrackFederation;
}

export function buildFederation(opts: { dbFile?: string; origin?: string; allowPrivateAddress?: boolean; startQueue?: boolean } = {}): Federation<void> {
  const file = opts.dbFile ?? process.env.FEDERATION_DB ?? './data/federation.db';
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const kvdb = new DatabaseSync(file);
  const federation = createFederation<void>({
    kv: new SqliteKvStore(kvdb),
    queue: new SqliteMessageQueue(kvdb),
    origin: opts.origin ?? publicOrigin(),
    // Dev flag (HTTP, private addresses of the docker network). Never in production: HTTPS required.
    allowPrivateAddress: opts.allowPrivateAddress ?? process.env.FEDERATION_DEV_HTTP === '1',
    outboxRetryPolicy: retryPolicy,
    // Clock (#1477): ±12 h tolerated on the signed date (drifting NAS, retrying queue); beyond that, signature rejected.
    signatureTimeWindow: { hours: LIMITS.clockSkewHours },
  });
  const { db } = getDb();

  federation
    .setActorDispatcher(ACTOR_PATH, async (ctx, identifier) => {
      const row = db.select({ id: user.id, name: user.name }).from(user).where(eq(user.handle, identifier.toLowerCase())).get();
      if (!row) return null;
      const keys = await ctx.getActorKeyPairs(identifier);
      // Handle and first name only: no email, no stats (and `profile_visibility` adds nothing more to expose).
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        name: row.name,
        inbox: ctx.getInboxUri(identifier),
        outbox: ctx.getOutboxUri(identifier),
        followers: ctx.getFollowersUri(identifier),
        following: ctx.getFollowingUri(identifier),
        endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
        publicKey: keys[0]?.cryptographicKey,
        assertionMethods: keys.map((k) => k.multikey),
      });
    })
    .mapHandle((_ctx, username) => (userIdByHandle(db, username) ? username.toLowerCase() : null))
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      const id = userIdByHandle(db, identifier);
      return id ? [await getUserKeyPair(db, id)] : [];
    });

  // A **public** outing can be read at its URL; the others (friends, invitation only) are never readable: 404, they only
  // travel in addressed activities (#1476).
  federation.setObjectDispatcher(Event, '/ap/outings/{id}', (_ctx, values) => {
    const o = db.select().from(outing).where(eq(outing.id, values.id)).get();
    const data = o && o.visibility === 'public' ? eventData(db, o) : null;
    return data ? buildEvent(data, { to: [PUBLIC_COLLECTION] }) : null;
  });

  // Empty collections in P4: filled by P5 (friends) and P6 (outings).
  federation.setOutboxDispatcher('/ap/users/{identifier}/outbox', async () => ({ items: [] }));
  federation.setFollowersDispatcher('/ap/users/{identifier}/followers', async () => ({ items: [] }));
  federation.setFollowingDispatcher('/ap/users/{identifier}/following', async () => ({ items: [] }));

  // Inbox: the signature is verified by Fedify (and the activity's actor = owner of the key).
  // Every activity caches the remote actor; friends (#1475) react to Follow / Accept / Reject / Undo.
  const cacheActor = async (ctx: Parameters<Parameters<ReturnType<typeof federation.setInboxListeners>['on']>[1]>[0], activity: Activity): Promise<string | null> => {
    try {
      const actor = await activity.getActor(ctx);
      if (!actor?.id || !actor.inboxId) return null;
      // Blocked server (signature verified by Fedify: the domain is the key's): nothing is cached or processed.
      if (isDomainBlocked(db, actor.id.host)) { logRefusal(db, { domain: actor.id.host.toLowerCase(), reason: 'blocked', activity: activity.constructor.name }); return null; }
      const key = await actor.getPublicKey(ctx);
      upsertRemoteActor(db, {
        actorUrl: actor.id.href,
        handle: actor.preferredUsername?.toString() ?? actor.id.pathname.split('/').pop() ?? '',
        displayName: actor.name?.toString() ?? null,
        inboxUrl: actor.inboxId.href,
        sharedInboxUrl: actor.endpoints?.sharedInbox?.href ?? null,
        publicKeyPem: key?.publicKey ? await publicKeyPem(key.publicKey) : null,
      });
      return actor.id.href;
    } catch (e) {
      console.warn('[federation] acteur distant illisible', e instanceof Error ? e.message : e);
      return null;
    }
  };
  /** Handle of my account targeted by a `Follow` (object = actor of this instance), otherwise null. */
  const localTarget = (ctx: { parseUri(u: URL | null): { type: string; identifier?: string } | null }, uri: URL | null) => {
    const p = ctx.parseUri(uri);
    return p?.type === 'actor' && p.identifier ? p.identifier : null;
  };
  const guard = async (what: string, fn: () => Promise<void> | void) => {
    try { await fn(); } catch (e) { console.warn(`[federation] ${what}`, e instanceof Error ? e.message : e); }
  };

  /** `Create` / `Update(Event)`: accounts of this instance named in `to` / `cc` (for "invitation only"), then cache. */
  const onEventActivity = async (ctx: Parameters<typeof cacheActor>[0], a: Create | Update) => {
    const actorUrl = await cacheActor(ctx, a);
    if (!actorUrl) return;
    await guard(a instanceof Create ? 'Create' : 'Update', async () => {
      const obj = await a.getObject(ctx);
      if (!(obj instanceof Event)) return;
      const data = await parseEvent(obj);
      if (!data) return;
      const handles = [...a.toIds, ...a.ccIds, ...obj.toIds, ...obj.ccIds].flatMap((u) => { const t = localTarget(ctx, u); return t ? [t] : []; });
      onEvent(db, actorUrl, data, [...new Set(handles)]);
    });
  };

  federation.setInboxListeners(INBOX_PATH, SHARED_INBOX_PATH)
    .on(Follow, async (ctx, follow) => {
      const actorUrl = await cacheActor(ctx, follow);
      const target = localTarget(ctx, follow.objectId);
      if (actorUrl && target) await guard('Follow', () => onFollow(db, actorUrl, target, follow.id?.href ?? null));
    })
    .on(Accept, async (ctx, accept) => {
      const actorUrl = await cacheActor(ctx, accept);
      if (!actorUrl) return;
      await guard('Accept', () => { onAccept(db, actorUrl, accept.objectId?.href ?? null); onJoinResult(db, actorUrl, accept.objectId?.href ?? null, true, null); });
    })
    .on(Reject, async (ctx, reject) => {
      const actorUrl = await cacheActor(ctx, reject);
      if (!actorUrl) return;
      await guard('Reject', () => { onReject(db, actorUrl, reject.objectId?.href ?? null); onJoinResult(db, actorUrl, reject.objectId?.href ?? null, false, reject.summary?.toString() ?? null); });
    })
    // Outings (#1476): answers from a remote account on an outing from here (`Join` = I'm in, `TentativeAccept` = maybe, `Leave` = no)…
    .on(Join, async (ctx, a) => {
      const actorUrl = await cacheActor(ctx, a);
      if (actorUrl) await guard('Join', () => onRemoteResponse(db, actorUrl, a.objectId?.href ?? null, 'yes', a.id?.href ?? null));
    })
    .on(TentativeAccept, async (ctx, a) => {
      const actorUrl = await cacheActor(ctx, a);
      if (actorUrl) await guard('TentativeAccept', () => onRemoteResponse(db, actorUrl, a.objectId?.href ?? null, 'maybe', a.id?.href ?? null));
    })
    .on(Leave, async (ctx, a) => {
      const actorUrl = await cacheActor(ctx, a);
      if (actorUrl) await guard('Leave', () => onRemoteResponse(db, actorUrl, a.objectId?.href ?? null, 'no', a.id?.href ?? null));
    })
    // … and outings from another server: cached copy (`Create` / `Update`), removal (`Delete`).
    .on(Create, (ctx, a) => onEventActivity(ctx, a))
    .on(Update, (ctx, a) => onEventActivity(ctx, a))
    .on(Delete, async (ctx, a) => {
      const actorUrl = await cacheActor(ctx, a);
      if (actorUrl) await guard('Delete', () => onDeleteEvent(db, actorUrl, a.objectId?.href ?? null));
    })
    .on(Undo, async (ctx, undo) => {
      const actorUrl = await cacheActor(ctx, undo);
      if (!actorUrl) return;
      await guard('Undo', async () => {
        const inner = await undo.getObject(ctx);
        if (!(inner instanceof Follow)) return;
        const target = localTarget(ctx, inner.objectId);
        if (target) await onUndoFollow(db, actorUrl, target);
      });
    })
    .on(Activity, async (ctx, activity) => { await cacheActor(ctx, activity); });

  federation.setNodeInfoDispatcher('/nodeinfo/2.1', async () => ({
    software: { name: 'singletrack', version: process.env.npm_package_version ?? '0.1.0', repository: process.env.SOURCE_URL ? new URL(process.env.SOURCE_URL) : undefined },
    protocols: ['activitypub'],
    openRegistrations: process.env.AUTH_DISABLE_SIGNUP !== 'true',
    usage: { users: { total: db.select({ n: count() }).from(user).where(isNotNull(user.handle)).get()?.n ?? 0 }, localPosts: 0, localComments: 0 },
  }));

  pruneRemoteOutings(db); // expired copies (#1477)
  if (opts.startQueue ?? true) void federation.startQueue(undefined);
  return federation;
}
