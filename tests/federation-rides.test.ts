import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { Document } from '@fedify/vocab';
import { openDb, type Db } from '@/db';
import { federationLog, friendship, invitation, outing, outingRide, remoteOuting, remoteResponse, remoteRide, user } from '@/db/schema';
import { ensureHandle } from '@/lib/federation/handle';
import { upsertRemoteActor } from '@/lib/federation/remote-actors';
import { onEvent, onJoinResult, onRemoteResponse, publishOuting, respondRemote, type OutingDeliver } from '@/lib/federation/outings';
import {
  buildRemoteRecap, buildRideDocument, deleteRemoteRide, listMyRemoteRide, onRemoteRide, onRemoteRideDelete, parseRideDocument, rideDocumentFor, rideUrlAllowed,
  saveRemoteRide, type RideDeliver, type RideFedDeps, type RideObject,
} from '@/lib/federation/rides';
import { remotePairKey } from '@/lib/friends';
import { haversine, type Position, type TrackGeometry } from '@/lib/geo';
import { upsertTrack } from '@/lib/tracks';
import { createOuting } from '@/lib/outings';
import { listRides, type RideStats } from '@/lib/outings/ride';

/**
 * Ridden tracks across servers (#1775). In-memory servers: one server's delivery calls the other's handlers, and the organiser's
 * "signed GET" reads the participant's `/ap/rides/<id>` document through a JSON-LD round trip (the network is covered by
 * scripts/federation-two-instances.ts).
 */
type Server = { db: Db; domain: string; supports: boolean; rideMsgs: number };
const servers: Record<string, Server> = {};
const actorUrl = (domain: string, handle: string) => `https://${domain}/ap/users/${handle}`;

async function as<T>(s: Server, fn: () => T | Promise<T>): Promise<T> {
  const prev = process.env.BETTER_AUTH_URL;
  vi.stubEnv('BETTER_AUTH_URL', `https://${s.domain}`);
  try { return await fn(); } finally { vi.stubEnv('BETTER_AUTH_URL', prev ?? ''); }
}
const senderIn = (target: Server, from: Server, handle: string) =>
  upsertRemoteActor(target.db, { actorUrl: actorUrl(from.domain, handle), handle, displayName: handle, inboxUrl: `${actorUrl(from.domain, handle)}/inbox` });

const outingDeliver = (from: Server): OutingDeliver => async (handle, to, msg) => {
  const target = servers[new URL(to.actorUrl).host];
  const sender = senderIn(target, from, handle);
  await as(target, async () => {
    if (msg.t === 'event') onEvent(target.db, sender.actorUrl, msg.data, [], (async () => {}) as never);
    else if (msg.t === 'join') await onRemoteResponse(target.db, sender.actorUrl, msg.objectUrl, msg.answer, `https://${from.domain}/ap/joins/${msg.joinId}`, { deliver: outingDeliver(target) });
    else if (msg.t === 'join-result') onJoinResult(target.db, sender.actorUrl, msg.joinUrl, msg.accepted, msg.reason ?? null);
  });
};

/** Organiser's signed GET: the participant's server answers as its object dispatcher would, for that reader. */
const fetchFrom = (organizer: Server) => async (handle: string, rideUrl: string): Promise<RideObject | null> => {
  const owner = servers[new URL(rideUrl).host];
  const id = new URL(rideUrl).pathname.split('/').pop()!;
  const doc = await as(owner, () => rideDocumentFor(owner.db, id, actorUrl(organizer.domain, handle)));
  return doc ? parseRideDocument(await Document.fromJsonLd(await doc.toJsonLd())) : null;
};
const rideDeliver = (from: Server): RideDeliver => async (handle, to, msg) => {
  from.rideMsgs++;
  const target = servers[new URL(to.actorUrl).host];
  const sender = senderIn(target, from, handle);
  await as(target, async () => {
    if (msg.t === 'ride') {
      // Through the wire format, as the inbox would see it.
      const back = parseRideDocument(await Document.fromJsonLd(await buildRideDocument(msg.ride).toJsonLd()))!;
      await onRemoteRide(target.db, sender.actorUrl, back, { fetchRide: fetchFrom(target) });
    } else onRemoteRideDelete(target.db, sender.actorUrl, msg.rideUrl);
  });
};
const rideDeps = (s: Server): RideFedDeps => ({
  deliver: rideDeliver(s), fetchRide: fetchFrom(s), supportsRides: async (url) => servers[new URL(url).host]?.supports ?? false,
});

function mk(domain: string, name: string, uid: string): Server {
  const { db } = openDb(':memory:');
  db.insert(user).values({ id: uid, name, email: `${uid}@x.test` }).run();
  ensureHandle(db, uid);
  return (servers[domain] = { db, domain, supports: true, rideMsgs: 0 });
}
function befriend(s: Server, uid: string, otherDomain: string, otherHandle: string) {
  const a = upsertRemoteActor(s.db, { actorUrl: actorUrl(otherDomain, otherHandle), handle: otherHandle, displayName: otherHandle, inboxUrl: `${actorUrl(otherDomain, otherHandle)}/inbox` });
  s.db.insert(friendship).values({ requesterId: uid, addresseeId: null, remoteActorId: a.id, pairKey: remotePairKey(uid, a.id), status: 'accepted' }).run();
}

/** A straight east-west ride of `km` kilometres starting at `lon0`. */
function ride(km: number, lon0 = 6.1): RideStats {
  const n = Math.round(km * 20) + 1; // a point every 50 m
  const coordinates = Array.from({ length: n }, (_, i) => [lon0 + (i * 0.05) / 81.2, 43.2, 100] as Position);
  return { geometry: { type: 'LineString', coordinates }, distanceM: km * 1000, gainM: 12, movingSec: 600, elapsedSec: 700, times: null };
}
const first = (g: TrackGeometry) => (g.type === 'LineString' ? g.coordinates[0] : g.coordinates[0][0]);

let a: Server, b: Server, c: Server;
let outingId: string;
let remoteId: string;

beforeEach(async () => {
  vi.stubEnv('FEDERATION', 'on');
  a = mk('a.example', 'Alice', 'ua');
  b = mk('b.example', 'Paul', 'up');
  c = mk('c.example', 'Zed', 'uz');
  befriend(a, 'ua', 'b.example', 'paul');
  befriend(a, 'ua', 'c.example', 'zed');
  befriend(b, 'up', 'a.example', 'alice');
  befriend(c, 'uz', 'a.example', 'alice');
  // Public outing on a, started an hour ago, pushed to b and c.
  vi.stubEnv('FEDERATION', 'off');
  const t = await upsertTrack(a.db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 20] as Position) }, raw: {},
  }, { enrich: false });
  const r = await as(a, () => createOuting(a.db, 'ua', { trackSlug: t.slug, title: 'Boucle du dimanche', date: '2099-05-10', time: '08:30', visibility: 'public' }));
  if (!('slug' in r)) throw new Error('création');
  vi.stubEnv('FEDERATION', 'on');
  const o = a.db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
  outingId = o.id;
  a.db.update(outing).set({ startsAt: new Date(Date.now() - 3600_000) }).where(eq(outing.id, o.id)).run();
  await as(a, () => publishOuting(a.db, o.id, 'Create', { deliver: outingDeliver(a) }));
  remoteId = b.db.select().from(remoteOuting).get()!.id;
  // Paul joins (`Join` → Accept on a's side).
  await as(b, () => respondRemote(b.db, 'up', remoteId, 'yes', { deliver: outingDeliver(b) }));
});
afterEach(() => { vi.unstubAllEnvs(); for (const k of Object.keys(servers)) delete servers[k]; });

const ridesOnA = () => a.db.select().from(outingRide).where(eq(outingRide.outingId, outingId)).all();

describe('traces roulées entre serveurs (#1775)', () => {
  it('le participant joint bien la sortie (préalable)', () => {
    expect(b.db.select().from(remoteResponse).get()).toMatchObject({ answer: 'yes', state: 'accepted' });
    expect(a.db.select().from(invitation).where(eq(invitation.outingId, outingId)).get()).toMatchObject({ status: 'yes', origin: 'remote' });
  });

  it('Create : la trace arrive chez l’organisateur, début et fin masqués ; Update la remplace ; Delete la retire', async () => {
    const s = ride(3);
    const res = await as(b, () => saveRemoteRide(b.db, 'up', remoteId, s, rideDeps(b)));
    expect(res).toMatchObject({ ok: true, federated: 'sent' });
    // Kept whole at home.
    expect(b.db.select().from(remoteRide).get()!.geometry).toEqual(s.geometry);
    let rows = ridesOnA();
    expect(rows).toHaveLength(1);
    expect(rows[0].remoteUrl).toMatch(/^https:\/\/b\.example\/ap\/rides\//);
    expect(rows[0].times).toBeNull();
    expect(rows[0]).toMatchObject({ distanceM: 3000, gainM: 12, movingSec: 600, elapsedSec: 700 });
    const startGap = haversine(first(s.geometry), first(rows[0].geometry));
    expect(startGap).toBeGreaterThan(290);
    expect(startGap).toBeLessThan(310);
    // Read by the organiser: not trimmed a second time.
    const seen = await as(a, () => listRides(a.db, outingId, { kind: 'organizer', userId: 'ua' }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ author: 'paul', mine: false, organizer: false });
    expect(seen[0].geometry).toEqual(rows[0].geometry);

    // Update: the new track replaces the old one (same row, same URL).
    const res2 = await as(b, () => saveRemoteRide(b.db, 'up', remoteId, ride(5, 6.2), rideDeps(b)));
    expect(res2).toMatchObject({ ok: true, federated: 'sent' });
    rows = ridesOnA();
    expect(rows).toHaveLength(1);
    expect(rows[0].distanceM).toBe(5000);
    expect(first(rows[0].geometry)[0]).toBeGreaterThan(6.2);

    // Delete.
    expect(await as(b, () => deleteRemoteRide(b.db, 'up', remoteId, rideDeps(b)))).toBe(true);
    expect(ridesOnA()).toHaveLength(0);
    expect(b.db.select().from(remoteRide).all()).toHaveLength(0);
  });

  it('acteur qui n’a pas fait Join ⇒ refusé, rien n’est stocké ni lu', async () => {
    const fetchRide = vi.fn(fetchFrom(a));
    const zed = senderIn(a, c, 'zed');
    const r: RideObject = {
      rideUrl: 'https://c.example/ap/rides/x', actorUrl: zed.actorUrl, eventUrl: `https://a.example/ap/outings/${outingId}`,
      distanceM: 1000, gainM: null, movingSec: null, elapsedSec: null, geometry: null,
    };
    expect(await as(a, () => onRemoteRide(a.db, zed.actorUrl, r, { fetchRide }))).toBe('refused');
    expect(fetchRide).not.toHaveBeenCalled();
    expect(ridesOnA()).toHaveLength(0);
    expect(a.db.select().from(federationLog).all().some((l) => l.domain === 'c.example' && l.activity === 'ride')).toBe(true);
  });

  it('invité révoqué ou ayant répondu « non » ⇒ refusé', async () => {
    a.db.update(invitation).set({ status: 'no' }).where(eq(invitation.outingId, outingId)).run();
    await as(b, () => saveRemoteRide(b.db, 'up', remoteId, ride(3), rideDeps(b)));
    expect(ridesOnA()).toHaveLength(0);
  });

  it('URL hors du serveur de l’acteur, ou trace d’un autre acteur ⇒ ignorée', async () => {
    const paul = senderIn(a, b, 'paul');
    const base = { actorUrl: paul.actorUrl, eventUrl: `https://a.example/ap/outings/${outingId}`, distanceM: 1, gainM: null, movingSec: null, elapsedSec: null, geometry: null };
    const fetchRide = vi.fn(async () => null);
    expect(await as(a, () => onRemoteRide(a.db, paul.actorUrl, { ...base, rideUrl: 'https://169.254.169.254/ap/rides/x' }, { fetchRide }))).toBe('ignored');
    expect(await as(a, () => onRemoteRide(a.db, paul.actorUrl, { ...base, actorUrl: actorUrl('c.example', 'zed'), rideUrl: 'https://b.example/ap/rides/x' }, { fetchRide }))).toBe('ignored');
    expect(fetchRide).not.toHaveBeenCalled();
    expect(rideUrlAllowed('http://b.example/ap/rides/x', paul.actorUrl)).toBe(false);
    expect(rideUrlAllowed('https://b.example/ap/rides/x', paul.actorUrl)).toBe(true);
  });

  it('un Delete d’un autre acteur ne retire pas la trace', async () => {
    await as(b, () => saveRemoteRide(b.db, 'up', remoteId, ride(3), rideDeps(b)));
    const url = ridesOnA()[0].remoteUrl!;
    const zed = senderIn(a, c, 'zed');
    expect(onRemoteRideDelete(a.db, zed.actorUrl, url)).toBe(false);
    expect(ridesOnA()).toHaveLength(1);
  });

  it('serveur de l’organisateur ancien (pas d’annonce NodeInfo) ⇒ trace gardée chez le participant, rien envoyé, sans erreur', async () => {
    a.supports = false;
    const res = await as(b, () => saveRemoteRide(b.db, 'up', remoteId, ride(3), rideDeps(b)));
    expect(res).toMatchObject({ ok: true, federated: 'unsupported' });
    expect(b.rideMsgs).toBe(0);
    expect(ridesOnA()).toHaveLength(0);
    expect(b.db.select().from(remoteRide).get()!.sentAt).toBeNull();
    expect(listMyRemoteRide(b.db, 'up', remoteId)[0]).toMatchObject({ mine: true, federated: false, distanceM: 3000 });
    // Its removal then sends nothing either.
    await as(b, () => deleteRemoteRide(b.db, 'up', remoteId, rideDeps(b)));
    expect(b.rideMsgs).toBe(0);
  });

  it('fédération coupée ⇒ gardée ici (`off`) ; trace ≤ 600 m ⇒ rien à montrer (`tooShort`)', async () => {
    vi.stubEnv('FEDERATION', 'off');
    expect(await as(b, () => saveRemoteRide(b.db, 'up', remoteId, ride(3), rideDeps(b)))).toMatchObject({ ok: true, federated: 'off' });
    vi.stubEnv('FEDERATION', 'on');
    expect(await as(b, () => saveRemoteRide(b.db, 'up', remoteId, ride(0.5), rideDeps(b)))).toMatchObject({ ok: true, federated: 'tooShort' });
    expect(b.rideMsgs).toBe(0);
  });

  it('participant qui n’a pas rejoint, sortie annulée ou pas commencée ⇒ refusé chez lui', async () => {
    b.db.update(remoteResponse).set({ answer: 'no' }).where(eq(remoteResponse.userId, 'up')).run();
    expect(await as(b, () => saveRemoteRide(b.db, 'up', remoteId, ride(3), rideDeps(b)))).toEqual({ ok: false, error: 'not_found' });
    b.db.update(remoteResponse).set({ answer: 'yes' }).where(eq(remoteResponse.userId, 'up')).run();
    b.db.update(remoteOuting).set({ startsAt: new Date(Date.now() + 86_400_000) }).where(eq(remoteOuting.id, remoteId)).run();
    expect(await as(b, () => saveRemoteRide(b.db, 'up', remoteId, ride(3), rideDeps(b)))).toEqual({ ok: false, error: 'tooEarly' });
    b.db.update(remoteOuting).set({ status: 'cancelled', startsAt: new Date(Date.now() - 3600_000) }).where(eq(remoteOuting.id, remoteId)).run();
    expect(await as(b, () => saveRemoteRide(b.db, 'up', remoteId, ride(3), rideDeps(b)))).toEqual({ ok: false, error: 'closed' });
  });

  it('/ap/rides/<id> n’est servi qu’à l’organisateur, déjà rogné', async () => {
    await as(b, () => saveRemoteRide(b.db, 'up', remoteId, ride(3), rideDeps(b)));
    const id = b.db.select().from(remoteRide).get()!.id;
    await as(b, () => {
      expect(rideDocumentFor(b.db, id, actorUrl('c.example', 'zed'))).toBeNull();
      expect(rideDocumentFor(b.db, id, null)).toBeNull();
      expect(rideDocumentFor(b.db, 'nope', actorUrl('a.example', 'alice'))).toBeNull();
      expect(rideDocumentFor(b.db, id, actorUrl('a.example', 'alice'))).not.toBeNull();
    });
  });

  it('Document : aller-retour JSON-LD, valeurs hors bornes et géométrie invalide refusées', async () => {
    const r: RideObject = {
      rideUrl: 'https://b.example/ap/rides/1', actorUrl: actorUrl('b.example', 'paul'), eventUrl: 'https://a.example/ap/outings/o',
      distanceM: 1234.4, gainM: 10, movingSec: null, elapsedSec: 99, geometry: ride(1).geometry,
    };
    const back = parseRideDocument(await Document.fromJsonLd(await buildRideDocument(r).toJsonLd()))!;
    expect(back).toEqual({ ...r, distanceM: 1234 });
    const bad = (ext: object) => new Document({
      id: new URL(r.rideUrl), attribution: new URL(r.actorUrl), replyTarget: new URL(r.eventUrl), name: 'singletrack:ride',
      url: new URL(`data:application/json;base64,${Buffer.from(JSON.stringify(ext)).toString('base64')}`),
    });
    expect(parseRideDocument(bad({ v: 1, distanceM: -1 }))).toBeNull();
    expect(parseRideDocument(bad({ v: 2, distanceM: 1 }))).toBeNull();
    expect(parseRideDocument(bad({ v: 1, distanceM: 1, geometry: { type: 'Point', coordinates: [1, 2] } }))).toBeNull();
    expect(parseRideDocument(bad({ v: 1, distanceM: 1, geometry: { type: 'LineString', coordinates: [[1, 'x']] } }))).toBeNull();
    expect(parseRideDocument(bad({ v: 1, distanceM: 1 }))).toMatchObject({ geometry: null });
  });

  it('la trace d’un participant distant ne garde pas de lien vers une autre invitation', async () => {
    await as(b, () => saveRemoteRide(b.db, 'up', remoteId, ride(3), rideDeps(b)));
    const row = ridesOnA()[0];
    const inv = a.db.select().from(invitation).where(and(eq(invitation.id, row.invitationId!))).get()!;
    expect(inv.remoteActorId).toBeTruthy();
    expect(row.authorUserId).toBeNull();
  });
});

describe('résumé perso d’une sortie distante (#1779)', () => {
  it('construit depuis ma trace entière gardée ici, sans média ; rien sans trace, ni si je n’ai pas rejoint', async () => {
    expect(buildRemoteRecap(b.db, 'up', remoteId)).toBeNull();
    const s = ride(3);
    await as(b, () => saveRemoteRide(b.db, 'up', remoteId, s, rideDeps(b)));
    const r = buildRemoteRecap(b.db, 'up', remoteId)!;
    expect(r.track).toMatchObject({ geometry: s.geometry, distanceM: 3000, gainM: 12, times: null });
    expect(r.track!.profile).not.toBeNull();
    expect(r.media).toEqual([]);
    expect(r.choices).toEqual([]);
    b.db.update(remoteResponse).set({ answer: 'no' }).where(eq(remoteResponse.userId, 'up')).run();
    expect(buildRemoteRecap(b.db, 'up', remoteId)).toBeNull();
  });
});
