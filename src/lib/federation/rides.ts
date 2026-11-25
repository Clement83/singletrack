import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getNodeInfo, signRequest } from '@fedify/fedify';
import { Create, Delete, Document, Tombstone, Update } from '@fedify/vocab';
import type { Db } from '@/db';
import { invitation, outing, outingRide, remoteActor, remoteOuting, remoteRide } from '@/db/schema';
import { bboxOf, simplifyGeometry, trimEnds, type TrackGeometry } from '@/lib/geo';
import { slopeProfileOf, type Recap } from '@/lib/outings/recap';
import { canUploadRide, storeRide, type RideStats } from '@/lib/outings/ride';
import { federationEnabled, publicOrigin } from './config';
import { getFederation } from './index';
import { getHandle } from './handle';
import { getRemoteActor } from './remote-actors';
import { isDomainBlocked, logRefusal } from './moderation';
import { listRemoteOutings, localOutingId, organizerOf, sanitizeGeometry } from './outings';

/**
 * Ridden tracks across servers (#1775, docs/federation.md §12). **The organiser's server is the reference**: a participant
 * from another server keeps their track at home (`remote_ride`, whole) and sends the organiser's server a signed activity
 * tied to the `Event`:
 *
 * - `Create(Document)` / `Update(Document)` named `singletrack:ride`, `inReplyTo` = the `Event`, carrying the ride URL
 *   (`/ap/rides/<id>`) and the stats only (the activity stays far below the 256 KB inbox limit);
 * - the organiser's server reads the track itself with a **signed** GET of that URL (same host as the actor, bounded size);
 *   the participant's server serves it **only** to the organiser's actor, first and last 300 m already hidden (`trimEnds`);
 * - `Delete(Tombstone)` removes it;
 * - accepted only from an actor who has joined (live invitation of that remote actor, answered "yes" or "maybe");
 * - sent only if the organiser's server announces the feature in its NodeInfo (`metadata.features` holds
 *   `singletrack:rides`); otherwise the track stays here (`federated: 'unsupported'`).
 */

export const RIDES_FEATURE = 'singletrack:rides';
export const RIDE_NAME = 'singletrack:ride';
/** Bounded read of a fetched ride document; the served document is simplified to stay below `MAX_DOC_JSON`. */
export const RIDE_FETCH_MAX_BYTES = 3_000_000;
const MAX_DOC_JSON = 1_500_000;
const DATA_PREFIX = 'data:application/json;base64,';

export const rideObjectUrl = (id: string) => `${publicOrigin()}/ap/rides/${id}`;

/** A ride as it travels: stats always, geometry only in the fetched document (already trimmed). */
export type RideObject = {
  rideUrl: string;
  actorUrl: string;
  eventUrl: string;
  distanceM: number;
  gainM: number | null;
  movingSec: number | null;
  elapsedSec: number | null;
  geometry: TrackGeometry | null;
};

export type RideMsg = { t: 'ride'; verb: 'Create' | 'Update'; ride: RideObject } | { t: 'ride-delete'; rideUrl: string };
type ActorRow = typeof remoteActor.$inferSelect;
export type RideDeliver = (handle: string, to: ActorRow, msg: RideMsg) => Promise<void>;
/** Signed GET of a ride document as `handle` (organiser side); null when unreadable, refused or too large. */
export type RideFetch = (handle: string, rideUrl: string) => Promise<RideObject | null>;
/** Does the server of this actor announce the reception of ridden tracks? */
export type RideSupport = (actorUrl: string) => Promise<boolean>;
export type RideFedDeps = { deliver: RideDeliver; fetchRide: RideFetch; supportsRides: RideSupport };

// ───────────────────────── Serialisation ─────────────────────────

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function encodeExt(r: RideObject): string {
  const base = { v: 1, distanceM: r.distanceM, gainM: r.gainM, movingSec: r.movingSec, elapsedSec: r.elapsedSec };
  let json = JSON.stringify(base);
  if (r.geometry) {
    for (const tol of [0, 10, 20, 40, 80]) {
      json = JSON.stringify({ ...base, geometry: tol ? simplifyGeometry(r.geometry, tol) : r.geometry });
      if (json.length <= MAX_DOC_JSON) break;
    }
  }
  return `${DATA_PREFIX}${Buffer.from(json).toString('base64')}`;
}

export function buildRideDocument(r: RideObject): Document {
  return new Document({
    id: new URL(r.rideUrl),
    attribution: new URL(r.actorUrl),
    replyTarget: new URL(r.eventUrl),
    name: RIDE_NAME,
    mediaType: 'application/json',
    url: new URL(encodeExt(r)),
  });
}

export const isRideDocument = (o: unknown): o is Document => o instanceof Document && o.name?.toString() === RIDE_NAME;

/** Fedify `Document` → ride (null if incomplete). Values are checked; the geometry, when present, must be a valid line. */
export function parseRideDocument(doc: Document): RideObject | null {
  const rideUrl = doc.id?.href;
  const actorUrl = doc.attributionId?.href;
  const eventUrl = doc.replyTargetId?.href;
  const href = doc.url instanceof URL ? doc.url.href : doc.url?.href?.href;
  if (!rideUrl || !actorUrl || !eventUrl || !href?.startsWith(DATA_PREFIX) || href.length > MAX_DOC_JSON * 1.5) return null;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(Buffer.from(href.slice(DATA_PREFIX.length), 'base64').toString('utf8')); } catch { return null; }
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  const distanceM = num(raw.distanceM);
  if (distanceM == null || distanceM < 0 || distanceM > 2_000_000) return null;
  const geometry = raw.geometry === undefined ? null : sanitizeGeometry(raw.geometry);
  if (raw.geometry !== undefined && !geometry) return null;
  const pos = (v: unknown) => { const n = num(v); return n != null && n >= 0 ? Math.round(n) : null; };
  return { rideUrl, actorUrl, eventUrl, distanceM: Math.round(distanceM), gainM: pos(raw.gainM), movingSec: pos(raw.movingSec), elapsedSec: pos(raw.elapsedSec), geometry };
}

// ───────────────────────── Organiser side ─────────────────────────

/** The URL may only be read on the actor's own host (no request to an arbitrary address), in HTTPS outside development. */
export function rideUrlAllowed(rideUrl: string, actorUrl: string): boolean {
  try {
    const u = new URL(rideUrl);
    const a = new URL(actorUrl);
    const httpOk = u.protocol === 'https:' || (u.protocol === 'http:' && process.env.FEDERATION_DEV_HTTP === '1');
    return httpOk && u.origin === a.origin && !u.username && !u.password;
  } catch { return false; }
}

export type RemoteRideOutcome = 'stored' | 'refused' | 'ignored';

/**
 * `Create` / `Update` of a ride from a participant on another server. Accepted only if the ride is the signing actor's, hosted on
 * its server, for an outing of this instance that has started and is not cancelled, **and** the actor joined it (live invitation
 * answered "yes" or "maybe"). The track is then read by a signed request and stored as that guest's ride (replacing it).
 */
export async function onRemoteRide(db: Db, actorUrl: string, data: RideObject, deps: Pick<RideFedDeps, 'fetchRide'> = defaultRideDeps, now = new Date()): Promise<RemoteRideOutcome> {
  const actor = getRemoteActor(db, actorUrl);
  if (!actor || data.actorUrl !== actor.actorUrl || !rideUrlAllowed(data.rideUrl, actor.actorUrl) || isDomainBlocked(db, actor.domain)) return 'ignored';
  const id = localOutingId(data.eventUrl);
  const o = id ? db.select().from(outing).where(eq(outing.id, id)).get() : undefined;
  const org = o && organizerOf(o);
  const handle = org ? getHandle(db, org).handle : null;
  const inv = o && db.select().from(invitation).where(and(eq(invitation.outingId, o.id), eq(invitation.remoteActorId, actor.id))).get();
  const joined = !!inv && !inv.revokedAt && (inv.status === 'yes' || inv.status === 'maybe');
  if (!o || !handle || !joined || !canUploadRide(o, now)) {
    logRefusal(db, { domain: actor.domain, reason: 'invalid', activity: 'ride' }, now);
    return 'refused';
  }
  // The same ride URL always belongs to the same guest.
  const other = db.select({ inv: outingRide.invitationId }).from(outingRide).where(eq(outingRide.remoteUrl, data.rideUrl)).get();
  if (other && other.inv !== inv.id) return 'refused';
  const full = await deps.fetchRide(handle, data.rideUrl);
  if (!full?.geometry || full.rideUrl !== data.rideUrl || full.actorUrl !== actor.actorUrl) return 'ignored';
  storeRide(db, o, { kind: 'guest', invitationId: inv.id }, {
    geometry: full.geometry, distanceM: full.distanceM, gainM: full.gainM, movingSec: full.movingSec, elapsedSec: full.elapsedSec, times: null,
  }, now, data.rideUrl);
  return 'stored';
}

/** `Delete` of a ride: removed only if it belongs to that actor. */
export function onRemoteRideDelete(db: Db, actorUrl: string, rideUrl: string | null): boolean {
  const actor = getRemoteActor(db, actorUrl);
  if (!actor || !rideUrl) return false;
  const row = db.select({ id: outingRide.id }).from(outingRide).innerJoin(invitation, eq(invitation.id, outingRide.invitationId))
    .where(and(eq(outingRide.remoteUrl, rideUrl), eq(invitation.remoteActorId, actor.id))).get();
  if (!row) return false;
  db.delete(outingRide).where(eq(outingRide.id, row.id)).run();
  return true;
}

// ───────────────────────── Participant side ─────────────────────────

type RemoteCtx = { ro: typeof remoteOuting.$inferSelect; organizer: ActorRow };

/** Remote outing I joined ("yes" / "maybe", not refused by the organiser) and still see; otherwise undefined. */
export function joinedRemoteOuting(db: Db, userId: string, remoteOutingId: string, now = new Date()): RemoteCtx | undefined {
  const v = listRemoteOutings(db, userId, { id: remoteOutingId, now })[0];
  if (!v || (v.answer !== 'yes' && v.answer !== 'maybe') || v.state === 'rejected') return undefined;
  const row = db.select({ ro: remoteOuting, organizer: remoteActor }).from(remoteOuting).innerJoin(remoteActor, eq(remoteActor.id, remoteOuting.remoteActorId))
    .where(eq(remoteOuting.id, remoteOutingId)).get();
  return row ?? undefined;
}

export type RemoteRideView = {
  id: string; author: string; organizer: false; mine: true; geometry: TrackGeometry; bbox: [number, number, number, number];
  distanceM: number; gainM: number | null; movingSec: number | null; elapsedSec: number | null; federated: boolean;
};

/** My own ride on a remote outing (whole, it is mine), in the shape of `listRides`. */
export function listMyRemoteRide(db: Db, userId: string, remoteOutingId: string): RemoteRideView[] {
  const r = db.select().from(remoteRide).where(and(eq(remoteRide.remoteOutingId, remoteOutingId), eq(remoteRide.userId, userId))).get();
  if (!r) return [];
  const pts = (r.geometry.type === 'LineString' ? [r.geometry.coordinates] : r.geometry.coordinates).flat();
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  return [{
    id: r.id, author: '', organizer: false, mine: true, geometry: r.geometry,
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    distanceM: r.distanceM, gainM: r.gainM, movingSec: r.movingSec, elapsedSec: r.elapsedSec, federated: !!r.sentAt,
  }];
}

/**
 * What happened to the track on the federation side: `sent` (delivered to the organiser's server), `unsupported` (that server does
 * not receive tracks yet: kept here, nothing sent), `off` (federation off here), `tooShort` (≤ 600 m: nothing left once trimmed).
 */
export type Federated = 'sent' | 'unsupported' | 'off' | 'tooShort';
export type RemoteRideResult = { ok: true; id: string; federated: Federated } | { ok: false; error: 'not_found' | 'closed' | 'tooEarly' };

const remoteCtxSender = (db: Db, userId: string) => (federationEnabled() ? getHandle(db, userId).handle : null);

async function sendRide(db: Db, deps: RideFedDeps, handle: string, to: ActorRow, msg: RideMsg) {
  if (isDomainBlocked(db, to.domain)) return false;
  try { await deps.deliver(handle, to, msg); return true; } catch (e) { console.warn('[federation] envoi trace', msg.t, e instanceof Error ? e.message : e); return false; }
}

/** Delivers (or withdraws) my ride for this remote outing according to its current state. */
async function pushRide(db: Db, userId: string, ctx: RemoteCtx, deps: RideFedDeps, now: Date): Promise<Federated> {
  const r = db.select().from(remoteRide).where(and(eq(remoteRide.remoteOutingId, ctx.ro.id), eq(remoteRide.userId, userId))).get();
  const handle = remoteCtxSender(db, userId);
  if (!r) return 'off';
  if (!handle) return 'off';
  const rideUrl = rideObjectUrl(r.id);
  if (!trimEnds(r.geometry)) {
    // Nothing left to show once trimmed: an earlier version is withdrawn.
    if (r.sentAt && (await sendRide(db, deps, handle, ctx.organizer, { t: 'ride-delete', rideUrl }))) {
      db.update(remoteRide).set({ sentAt: null }).where(eq(remoteRide.id, r.id)).run();
    }
    return 'tooShort';
  }
  if (!(await deps.supportsRides(ctx.organizer.actorUrl).catch(() => false))) return 'unsupported';
  const ride: RideObject = {
    rideUrl, actorUrl: `${publicOrigin()}/ap/users/${handle}`, eventUrl: ctx.ro.objectUrl,
    distanceM: r.distanceM, gainM: r.gainM, movingSec: r.movingSec, elapsedSec: r.elapsedSec, geometry: null,
  };
  if (!(await sendRide(db, deps, handle, ctx.organizer, { t: 'ride', verb: r.sentAt ? 'Update' : 'Create', ride }))) return 'unsupported';
  db.update(remoteRide).set({ sentAt: now }).where(eq(remoteRide.id, r.id)).run();
  return 'sent';
}

/** Stores (or replaces) my ride on a remote outing I joined, then sends it to the organiser's server when it can receive it. */
export async function saveRemoteRide(db: Db, userId: string, remoteOutingId: string, s: RideStats, deps: RideFedDeps = defaultRideDeps, now = new Date()): Promise<RemoteRideResult> {
  const ctx = joinedRemoteOuting(db, userId, remoteOutingId, now);
  if (!ctx) return { ok: false, error: 'not_found' };
  if (ctx.ro.status === 'cancelled') return { ok: false, error: 'closed' };
  if (!canUploadRide(ctx.ro, now)) return { ok: false, error: 'tooEarly' };
  const values = { geometry: s.geometry, distanceM: s.distanceM, gainM: s.gainM, movingSec: s.movingSec, elapsedSec: s.elapsedSec, times: s.times, updatedAt: now };
  const id = db.insert(remoteRide).values({ remoteOutingId, userId, ...values })
    .onConflictDoUpdate({ target: [remoteRide.remoteOutingId, remoteRide.userId], set: values }).returning({ id: remoteRide.id }).get().id;
  return { ok: true, id, federated: await pushRide(db, userId, ctx, deps, now) };
}

/** Removes my ride on a remote outing; if it had been delivered, `Delete` to the organiser's server. */
export async function deleteRemoteRide(db: Db, userId: string, remoteOutingId: string, deps: RideFedDeps = defaultRideDeps): Promise<boolean> {
  const row = db.select({ r: remoteRide, organizer: remoteActor }).from(remoteRide)
    .innerJoin(remoteOuting, eq(remoteOuting.id, remoteRide.remoteOutingId)).innerJoin(remoteActor, eq(remoteActor.id, remoteOuting.remoteActorId))
    .where(and(eq(remoteRide.remoteOutingId, remoteOutingId), eq(remoteRide.userId, userId))).get();
  if (!row) return false;
  db.delete(remoteRide).where(eq(remoteRide.id, row.r.id)).run();
  const handle = remoteCtxSender(db, userId);
  if (row.r.sentAt && handle) await sendRide(db, deps, handle, row.organizer, { t: 'ride-delete', rideUrl: rideObjectUrl(row.r.id) });
  return true;
}

/**
 * The ride document served at `/ap/rides/<id>`: only to the organiser of its outing (`readerActorUrl` = owner of the key that
 * signed the request), track trimmed (first and last 300 m hidden). Anyone else, or nothing left once trimmed: null (404).
 */
export function rideDocumentFor(db: Db, id: string, readerActorUrl: string | null | undefined): Document | null {
  if (!readerActorUrl) return null;
  const row = db.select({ r: remoteRide, ro: remoteOuting, organizer: remoteActor }).from(remoteRide)
    .innerJoin(remoteOuting, eq(remoteOuting.id, remoteRide.remoteOutingId)).innerJoin(remoteActor, eq(remoteActor.id, remoteOuting.remoteActorId))
    .where(eq(remoteRide.id, id)).get();
  if (!row || row.organizer.actorUrl !== readerActorUrl || isDomainBlocked(db, row.organizer.domain)) return null;
  const handle = getHandle(db, row.r.userId).handle;
  const geometry = trimEnds(row.r.geometry);
  if (!handle || !geometry) return null;
  return buildRideDocument({
    rideUrl: rideObjectUrl(id), actorUrl: `${publicOrigin()}/ap/users/${handle}`, eventUrl: row.ro.objectUrl,
    distanceM: row.r.distanceM, gainM: row.r.gainM, movingSec: row.r.movingSec, elapsedSec: row.r.elapsedSec, geometry,
  });
}

// ───────────────────────── Fedify / network ─────────────────────────

/** Delivery through the Fedify queue, to the organiser's actor only. */
export const deliverRideWithFedify: RideDeliver = async (handle, to, msg) => {
  const ctx = getFederation().createContext(new URL(publicOrigin()), undefined);
  const me = ctx.getActorUri(handle);
  const target = new URL(to.actorUrl);
  const recipient = { id: target, inboxId: new URL(to.inboxUrl), endpoints: to.sharedInboxUrl ? { sharedInbox: new URL(to.sharedInboxUrl) } : null };
  const aid = (kind: string) => new URL(`${publicOrigin()}/ap/${kind}/${randomUUID()}`);
  const activity = msg.t === 'ride'
    ? new (msg.verb === 'Create' ? Create : Update)({ id: aid(msg.verb.toLowerCase()), actor: me, object: buildRideDocument(msg.ride), tos: [target] })
    : new Delete({ id: aid('delete'), actor: me, object: new Tombstone({ id: new URL(msg.rideUrl) }), tos: [target] });
  await ctx.sendActivity({ identifier: handle }, recipient, activity);
};

/** Reads a body up to `max` bytes; null beyond (the rest is not downloaded). */
export async function readBounded(res: Response, max: number): Promise<string | null> {
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > max || !res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Signed GET (the organiser's key), no redirect, 15 s, bounded size, then checked parse. */
export const fetchRideWithFedify: RideFetch = async (handle, rideUrl) => {
  const ctx = getFederation().createContext(new URL(publicOrigin()), undefined);
  const [pair] = await ctx.getActorKeyPairs(handle);
  if (!pair) return null;
  const req = await signRequest(new Request(rideUrl, { headers: { accept: 'application/activity+json' } }), pair.privateKey, pair.keyId);
  const res = await fetch(req, { redirect: 'error', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return null;
  const text = await readBounded(res, RIDE_FETCH_MAX_BYTES);
  if (!text) return null;
  try {
    const doc = await Document.fromJsonLd(JSON.parse(text), { documentLoader: await ctx.getDocumentLoader({ identifier: handle }), contextLoader: ctx.contextLoader });
    return parseRideDocument(doc);
  } catch { return null; }
};

type G = typeof globalThis & { __singletrackRideSupport?: Map<string, { ok: boolean; at: number }> };
const SUPPORT_TTL_MS = 3600_000;

/** NodeInfo of the actor's server (a positive answer is cached one hour): `metadata.features` must list `singletrack:rides`. */
export const supportsRidesViaNodeInfo: RideSupport = async (actorUrl) => {
  const origin = new URL(actorUrl).origin;
  const g = globalThis as G;
  const cache = (g.__singletrackRideSupport ??= new Map());
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.at < SUPPORT_TTL_MS) return hit.ok;
  // Fedify refuses private addresses (production protection); the development flag (two local instances) reads it directly.
  const info = process.env.FEDERATION_DEV_HTTP === '1' ? await devNodeInfo(origin) : await getNodeInfo(origin, { parse: 'none' }).catch(() => undefined);
  const ok = announcesRides(info);
  // Only a positive answer is remembered: a server that upgrades (or a transient error) is seen at the next upload.
  if (ok) cache.set(origin, { ok, at: Date.now() });
  return ok;
};

/** Development only (`FEDERATION_DEV_HTTP=1`): `/.well-known/nodeinfo` then the 2.x document, bounded reads, no redirect. */
async function devNodeInfo(origin: string): Promise<unknown> {
  const get = async (url: string) => {
    const res = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8_000) }).catch(() => null);
    const text = res?.ok ? await readBounded(res, 256_000) : null;
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  };
  const wk = (await get(`${origin}/.well-known/nodeinfo`)) as { links?: { rel?: string; href?: string }[] } | null;
  const href = wk?.links?.find((l) => l.rel?.startsWith('http://nodeinfo.diaspora.software/ns/schema/2.'))?.href;
  return href && new URL(href).origin === origin ? get(href) : null;
}

export function announcesRides(nodeInfo: unknown): boolean {
  const features = (nodeInfo as { metadata?: { features?: unknown } } | null | undefined)?.metadata?.features;
  return Array.isArray(features) && features.includes(RIDES_FEATURE);
}

export const defaultRideDeps: RideFedDeps = { deliver: deliverRideWithFedify, fetchRide: fetchRideWithFedify, supportsRides: supportsRidesViaNodeInfo };


// ───────────────────────── Personal summary at home (#1779) ─────────────────────────

/**
 * Summary of a remote outing I joined, **at home**: my own `remote_ride` (whole, with its times) and nothing else. Photos and videos
 * of others are not federated (out of scope), so `media` and `choices` stay empty. `null` when I did not join, or have no track.
 */
export function buildRemoteRecap(db: Db, userId: string, remoteOutingId: string, now = new Date()): Recap | null {
  if (!joinedRemoteOuting(db, userId, remoteOutingId, now)) return null;
  const r = db.select().from(remoteRide).where(and(eq(remoteRide.remoteOutingId, remoteOutingId), eq(remoteRide.userId, userId))).get();
  const b = r && bboxOf(r.geometry);
  if (!r || !b) return null;
  const coords = r.geometry.type === 'LineString' ? r.geometry.coordinates : r.geometry.coordinates.flat();
  return {
    track: {
      id: r.id, geometry: r.geometry, bbox: [b.minLon, b.minLat, b.maxLon, b.maxLat], distanceM: r.distanceM, gainM: r.gainM,
      times: r.times && r.times.length === coords.length ? r.times : null,
      profile: coords.every((p) => typeof p[2] === 'number') ? slopeProfileOf(coords) : null,
      moments: [],
    },
    media: [],
    choices: [],
  };
}
