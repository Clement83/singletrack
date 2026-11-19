import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { Accept, Create, Delete, Event, Join, Leave, PUBLIC_COLLECTION, Reject, TentativeAccept, Update } from '@fedify/vocab';
import { openDb, type Db } from '@/db';
import { friendship, invitation, outing, remoteOuting, remoteResponse, user } from '@/db/schema';
import { ensureHandle } from '@/lib/federation/handle';
import { upsertRemoteActor } from '@/lib/federation/remote-actors';
import {
  buildEvent, deliverOutingWithFedify, eventData, joinUrl, listRemoteOutings, onDeleteEvent, onEvent, onJoinResult, onRemoteResponse,
  parseEvent, publishOuting, publishToActors, respondRemote, retractFromActor, type OutingDeliver, type OutingFedDeps, type OutingMsg,
} from '@/lib/federation/outings';
import { remotePairKey } from '@/lib/friends';
import { upsertTrack } from '@/lib/tracks';
import { countYes, createOuting, inviteFriends, listInvitableFriends, revokeInvitation, setStatus, updateOuting } from '@/lib/outings';

/**
 * In-memory servers: one server's delivery calls the other's handlers directly (the network is tested by
 * scripts/federation-two-instances.ts). The public origin is the one of the "current" server (`as`).
 */
type Server = { db: Db; domain: string; log: { to: string; msg: OutingMsg }[]; mails: { to: string; html: string }[] };
const servers: Record<string, Server> = {};
const actorUrl = (domain: string, handle: string) => `https://${domain}/ap/users/${handle}`;

async function as<T>(s: Server, fn: () => T | Promise<T>): Promise<T> {
  const prev = process.env.BETTER_AUTH_URL;
  vi.stubEnv('BETTER_AUTH_URL', `https://${s.domain}`);
  try { return await fn(); } finally { vi.stubEnv('BETTER_AUTH_URL', prev ?? ''); }
}

const deliverFrom = (from: Server): OutingDeliver => async (handle, to, msg) => {
  from.log.push({ to: to.actorUrl, msg });
  const url = new URL(to.actorUrl);
  const target = servers[url.host];
  const targetHandle = url.pathname.split('/').pop()!;
  const sender = upsertRemoteActor(target.db, { actorUrl: actorUrl(from.domain, handle), handle, displayName: handle, inboxUrl: `${actorUrl(from.domain, handle)}/inbox` });
  const mailer = async (m: { to: string; html: string }) => { target.mails.push(m); };
  await as(target, async () => {
    if (msg.t === 'event') onEvent(target.db, sender.actorUrl, msg.data, msg.addressing === 'invite' ? [targetHandle] : [], mailer as never);
    else if (msg.t === 'delete') onDeleteEvent(target.db, sender.actorUrl, msg.objectUrl);
    else if (msg.t === 'join') await onRemoteResponse(target.db, sender.actorUrl, msg.objectUrl, msg.answer, `https://${from.domain}/ap/joins/${msg.joinId}`, depsFor(target));
    else if (msg.t === 'join-result') onJoinResult(target.db, sender.actorUrl, msg.joinUrl, msg.accepted, msg.reason ?? null);
  });
};
const depsFor = (s: Server): OutingFedDeps => ({ deliver: deliverFrom(s) });

function mk(domain: string, name: string, uid: string): Server {
  const { db } = openDb(':memory:');
  db.insert(user).values({ id: uid, name, email: `${uid}@x.test` }).run();
  ensureHandle(db, uid);
  return (servers[domain] = { db, domain, log: [], mails: [] });
}
/** Accepted friendship between my local account and an account on the other server. */
function befriend(s: Server, uid: string, otherDomain: string, otherHandle: string) {
  const a = upsertRemoteActor(s.db, { actorUrl: actorUrl(otherDomain, otherHandle), handle: otherHandle, displayName: otherHandle, inboxUrl: `${actorUrl(otherDomain, otherHandle)}/inbox` });
  s.db.insert(friendship).values({ requesterId: uid, addresseeId: null, remoteActorId: a.id, pairKey: remotePairKey(uid, a.id), status: 'accepted' }).run();
  return a;
}

/** Fake Fedify: every "real" delivery (triggered by the hooks in the services) is captured here, never sent. */
type Sent = { sender: unknown; to: { id: URL }; activity: Create | Update | Delete | Join | Leave | TentativeAccept | Accept | Reject };
const sent: Sent[] = [];
type G = typeof globalThis & { __singletrackFederation?: unknown };
beforeEach(() => {
  sent.length = 0;
  (globalThis as G).__singletrackFederation = {
    createContext: () => ({
      getActorUri: (h: string) => new URL(`https://a.example/ap/users/${h}`),
      getFollowersUri: (h: string) => new URL(`https://a.example/ap/users/${h}/followers`),
      sendActivity: async (sender: unknown, to: Sent['to'], activity: Sent['activity']) => { sent.push({ sender, to, activity }); },
    }),
  };
});
afterEach(() => { delete (globalThis as G).__singletrackFederation; });

let a: Server, b: Server, c: Server;
const dbA = () => a.db;
async function newOuting(extra: object = {}) {
  vi.stubEnv('FEDERATION', 'off'); // creation without delivery: deliveries are triggered explicitly with in-memory servers
  const t = await upsertTrack(a.db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 20] as [number, number, number]) }, raw: {},
  }, { enrich: false }).catch(() => a.db.query);
  const r = await as(a, () => createOuting(a.db, 'ua', { trackSlug: (t as { slug: string }).slug, title: 'Boucle du dimanche', description: 'Cool', date: '2099-05-10', time: '08:30', ...extra }));
  if (!('slug' in r)) throw new Error('création');
  vi.stubEnv('FEDERATION', 'on');
  return a.db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
}

beforeEach(() => {
  vi.stubEnv('FEDERATION', 'on');
  vi.stubEnv('BETTER_AUTH_URL', 'https://a.example');
  a = mk('a.example', 'Alice', 'ua');
  b = mk('b.example', 'Paul', 'up');
  c = mk('c.example', 'Zed', 'uz');
  b.db.insert(user).values({ id: 'ub2', name: 'Bob', email: 'bob@x.test' }).run();
  ensureHandle(b.db, 'ub2');
  befriend(a, 'ua', 'b.example', 'paul');
  befriend(a, 'ua', 'c.example', 'zed');
  befriend(b, 'up', 'a.example', 'alice');
  befriend(c, 'uz', 'a.example', 'alice');
});
afterEach(() => { vi.unstubAllEnvs(); for (const k of Object.keys(servers)) delete servers[k]; });

describe('sorties entre serveurs (#1476)', () => {
  it('Event : aller-retour JSON-LD, extension trace, sans slug de la trace ni email', async () => {
    const o = await newOuting({ maxParticipants: 6, level: 'enduro' });
    const data = (await as(a, () => eventData(dbA(), o)))!;
    expect(data.objectUrl).toBe(`https://a.example/ap/outings/${o.id}`);
    const ev = buildEvent(data, { to: [PUBLIC_COLLECTION] });
    const wire = await ev.toJsonLd();
    const back = (await parseEvent(await Event.fromJsonLd(wire)))!;
    expect(back).toMatchObject({ title: 'Boucle du dimanche', description: 'Cool', lat: o.meetingLat, lon: o.meetingLon, actorUrl: 'https://a.example/ap/users/alice' });
    expect(back.startsAt.getTime()).toBe(o.startsAt.getTime());
    expect(back.ext).toMatchObject({ level: 'enduro', maxParticipants: 6, yesCount: 0, status: 'planned' });
    expect(back.ext.track?.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(back.ext.track?.attribution).toBe('© OSM');
    expect(back.ext.track?.slug).toBe('');
    const text = JSON.stringify(wire);
    expect(text).not.toContain(o.openLinkToken);
    expect(text).not.toContain('x.test');
    expect(Buffer.from(text.match(/base64,([A-Za-z0-9+/=]+)/)![1], 'base64').toString()).not.toContain(o.trackSnapshot.slug);
  });

  it('copains : l’Event va aux serveurs des copains, pas ailleurs ; visible des seuls copains de l’organisateur', async () => {
    const o = await newOuting({ visibility: 'friends' });
    await as(a, () => publishOuting(dbA(), o.id, 'Create', depsFor(a)));
    expect(a.log.map((l) => [l.to, l.msg.t === 'event' && l.msg.addressing]).sort()).toEqual([
      ['https://b.example/ap/users/paul', 'friends'], ['https://c.example/ap/users/zed', 'friends'],
    ]);
    expect(listRemoteOutings(b.db, 'up').map((v) => v.title)).toEqual(['Boucle du dimanche']);
    expect(listRemoteOutings(b.db, 'up')[0]).toMatchObject({ visibility: 'friends', invited: false, answer: 'pending', organizer: { handle: 'alice', domain: 'a.example' } });
    expect(listRemoteOutings(b.db, 'ub2')).toEqual([]); // account on B that is not Alice's friend
  });

  it('publique : visible de tout compte du serveur distant', async () => {
    const o = await newOuting({ visibility: 'public' });
    await as(a, () => publishOuting(dbA(), o.id, 'Create', depsFor(a)));
    expect(listRemoteOutings(b.db, 'up')).toHaveLength(1);
    expect(listRemoteOutings(b.db, 'ub2')).toHaveLength(1);
  });

  it('sur invitation : seulement le serveur du copain invité ; un copain non invité ne reçoit rien', async () => {
    const o = await newOuting({ visibility: 'invite' });
    // No invitation: nothing is sent.
    await as(a, () => publishOuting(dbA(), o.id, 'Create', depsFor(a)));
    expect(a.log).toEqual([]);

    const opts = listInvitableFriends(dbA(), 'ua', o);
    expect(opts.map((f) => f.name)).toEqual(['paul · b.example', 'zed · c.example']);
    const paulOpt = opts.find((f) => f.name.startsWith('paul'))!;
    expect(paulOpt.userId.startsWith('remote:')).toBe(true);
    vi.stubEnv('FEDERATION', 'off');
    expect(listInvitableFriends(dbA(), 'ua', o)).toEqual([]); // federation off: no remote invitation
    vi.stubEnv('FEDERATION', 'on');

    const r = await as(a, async () => inviteFriends(dbA(), 'ua', o, [paulOpt.userId, 'remote:inconnu']));
    expect(r).toEqual({ ok: true, invited: ['paul'], skipped: [] });
    const inv = dbA().select().from(invitation).where(eq(invitation.outingId, o.id)).all();
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ name: 'paul', status: 'pending', origin: 'remote', userId: null, tokenEnc: null });
    // Duplicate ignored.
    expect(await as(a, async () => inviteFriends(dbA(), 'ua', o, [paulOpt.userId]))).toEqual({ ok: true, invited: [], skipped: ['paul'] });

    await as(a, () => publishToActors(dbA(), o.id, [inv[0].remoteActorId!], depsFor(a)));
    expect(a.log.map((l) => l.to)).toEqual(['https://b.example/ap/users/paul']);
    expect(listRemoteOutings(c.db, 'uz')).toEqual([]);
    expect(c.db.select().from(remoteOuting).all()).toEqual([]);
    // At Paul's: pending invitation + email (link to the remote outing page, never /i/).
    const v = listRemoteOutings(b.db, 'up')[0];
    expect(v).toMatchObject({ invited: true, answer: 'pending', visibility: 'invite' });
    await vi.waitFor(() => expect(b.mails).toHaveLength(1));
    expect(b.mails[0].to).toBe('up@x.test');
    expect(b.mails[0].html).toContain(`/sorties/distante/${v.id}`);
    expect(b.mails[0].html).not.toContain('/i/');
    // A change still only reaches the guest.
    a.log.length = 0;
    await as(a, () => publishOuting(dbA(), o.id, 'Update', depsFor(a)));
    expect(a.log.map((l) => l.to)).toEqual(['https://b.example/ap/users/paul']);
  });

  it('un compte non copain de l’organisateur nommé dans une invitation est ignoré (pas d’invitation d’un inconnu)', async () => {
    const o = await newOuting({ visibility: 'invite' });
    const data = (await as(a, () => eventData(dbA(), o)))!;
    const sender = upsertRemoteActor(b.db, { actorUrl: actorUrl('a.example', 'alice'), handle: 'alice', inboxUrl: 'x' });
    await as(b, async () => { onEvent(b.db, sender.actorUrl, data, ['bob']); });
    expect(listRemoteOutings(b.db, 'ub2')).toEqual([]);
    expect(b.db.select().from(remoteResponse).all()).toEqual([]);
  });

  async function invitePaul(extra: object = {}) {
    const o = await newOuting({ visibility: 'invite', ...extra });
    const paul = listInvitableFriends(dbA(), 'ua', o).find((f) => f.name.startsWith('paul'))!;
    await as(a, async () => inviteFriends(dbA(), 'ua', o, [paul.userId]));
    const actorId = dbA().select().from(invitation).where(eq(invitation.outingId, o.id)).get()!.remoteActorId!;
    await as(a, () => publishToActors(dbA(), o.id, [actorId], depsFor(a)));
    return { o, actorId, rid: listRemoteOutings(b.db, 'up')[0].id };
  }

  it('réponses : je viens / peut-être / non appliqués chez l’organisateur, état confirmé et renvoyé', async () => {
    const { o, rid } = await invitePaul({ maxParticipants: 5 });
    expect(await as(b, () => respondRemote(b.db, 'up', rid, 'yes', depsFor(b)))).toEqual({ ok: true });
    expect(dbA().select().from(invitation).where(eq(invitation.outingId, o.id)).get()).toMatchObject({ status: 'yes' });
    expect(countYes(dbA(), o.id)).toBe(1);
    // At Paul's: Accept received, then Update(Event) with the up-to-date count.
    expect(listRemoteOutings(b.db, 'up')[0]).toMatchObject({ answer: 'yes', state: 'accepted', yesCount: 1, spotsLeft: 4 });
    await as(b, () => respondRemote(b.db, 'up', rid, 'maybe', depsFor(b)));
    expect(dbA().select().from(invitation).where(eq(invitation.outingId, o.id)).get()?.status).toBe('maybe');
    expect(listRemoteOutings(b.db, 'up')[0]).toMatchObject({ answer: 'maybe', yesCount: 0 });
    await as(b, () => respondRemote(b.db, 'up', rid, 'no', depsFor(b)));
    expect(dbA().select().from(invitation).where(eq(invitation.outingId, o.id)).get()?.status).toBe('no');
    expect(await as(b, () => respondRemote(b.db, 'up', rid, 'peut-etre', depsFor(b)))).toEqual({ ok: false, error: 'invalid' });
    expect(await as(b, () => respondRemote(b.db, 'up', 'inconnu', 'yes', depsFor(b)))).toEqual({ ok: false, error: 'not_found' });
  });

  it('places : sortie complète ⇒ Reject « full », la réponse n’est pas comptée', async () => {
    const { o, rid } = await invitePaul({ maxParticipants: 1 });
    dbA().insert(invitation).values({ outingId: o.id, tokenHash: 'h1', name: 'Marc', status: 'yes' }).run();
    await as(b, () => respondRemote(b.db, 'up', rid, 'yes', depsFor(b)));
    expect(countYes(dbA(), o.id)).toBe(1);
    expect(dbA().select().from(invitation).where(and(eq(invitation.outingId, o.id), eq(invitation.origin, 'remote'))).get()?.status).toBe('pending');
    expect(listRemoteOutings(b.db, 'up')[0]).toMatchObject({ answer: 'yes', state: 'rejected', reason: 'full', spotsLeft: 0 });
    // "maybe" is still possible: it takes no seat.
    await as(b, () => respondRemote(b.db, 'up', rid, 'maybe', depsFor(b)));
    expect(listRemoteOutings(b.db, 'up')[0]).toMatchObject({ state: 'accepted', answer: 'maybe' });
  });

  it('modification et annulation : Update(Event) vers l’invité ; sortie annulée ⇒ réponse impossible', async () => {
    const { o, rid } = await invitePaul();
    vi.stubEnv('FEDERATION', 'off');
    expect(await as(a, async () => updateOuting(dbA(), 'ua', o.slug, { title: 'Nouveau titre', maxParticipants: 3 }))).toEqual({ ok: true });
    vi.stubEnv('FEDERATION', 'on');
    await as(a, () => publishOuting(dbA(), o.id, 'Update', depsFor(a)));
    expect(listRemoteOutings(b.db, 'up')[0]).toMatchObject({ id: rid, title: 'Nouveau titre', maxParticipants: 3 }); // same copy, updated
    vi.stubEnv('FEDERATION', 'off');
    await as(a, async () => setStatus(dbA(), 'ua', o.slug, 'cancelled'));
    vi.stubEnv('FEDERATION', 'on');
    await as(a, () => publishOuting(dbA(), o.id, 'Update', depsFor(a)));
    expect(listRemoteOutings(b.db, 'up')[0]).toMatchObject({ status: 'cancelled', closed: true });
    expect(await as(b, () => respondRemote(b.db, 'up', rid, 'yes', depsFor(b)))).toEqual({ ok: false, error: 'closed' });
  });

  it('un serveur distant qui répond à une sortie fermée reçoit « closed » ; un invité révoqué « forbidden »', async () => {
    const { o, actorId } = await invitePaul();
    const sender = upsertRemoteActor(a.db, { actorUrl: actorUrl('b.example', 'paul'), handle: 'paul', inboxUrl: 'x' });
    vi.stubEnv('FEDERATION', 'off');
    const inv = dbA().select().from(invitation).where(eq(invitation.outingId, o.id)).get()!;
    revokeInvitation(dbA(), 'ua', o.slug, inv.id);
    vi.stubEnv('FEDERATION', 'on');
    const log: OutingMsg[] = [];
    const spy: OutingFedDeps = { deliver: async (_h, _to, m) => { log.push(m); } };
    await as(a, () => onRemoteResponse(dbA(), sender.actorUrl, `https://a.example/ap/outings/${o.id}`, 'yes', 'https://b.example/ap/joins/j1', spy));
    expect(log[0]).toMatchObject({ t: 'join-result', accepted: false, reason: 'forbidden' });
    expect(actorId).toBe(sender.id);
  });

  it('retrait d’un invité : Delete(Event) vers son serveur, la copie disparaît', async () => {
    const { o, actorId, rid } = await invitePaul();
    expect(listRemoteOutings(b.db, 'up')).toHaveLength(1);
    await as(a, () => retractFromActor(dbA(), o.id, actorId, depsFor(a)));
    expect(listRemoteOutings(b.db, 'up', { id: rid })).toEqual([]);
    expect(b.db.select().from(remoteResponse).all()).toEqual([]);
  });

  it('droits : silence pour un serveur sans droit (copains / sur invitation) ; publique ouverte à tout serveur', async () => {
    const spy: OutingDeliver = vi.fn(async () => {});
    const deps = { deliver: spy };
    const z = upsertRemoteActor(a.db, { actorUrl: actorUrl('d.example', 'zoe'), handle: 'zoe', inboxUrl: 'x' });
    const inviteOnly = await newOuting({ visibility: 'invite' });
    const friendsOnly = await newOuting({ visibility: 'friends', title: 'Entre copains' });
    const pub = await newOuting({ visibility: 'public', title: 'Pour tous' });
    for (const o of [inviteOnly, friendsOnly]) await as(a, () => onRemoteResponse(dbA(), z.actorUrl, `https://a.example/ap/outings/${o.id}`, 'yes', 'https://d.example/ap/joins/1', deps));
    expect(spy).not.toHaveBeenCalled();
    expect(dbA().select().from(invitation).where(eq(invitation.remoteActorId, z.id)).all()).toEqual([]);
    await as(a, () => onRemoteResponse(dbA(), z.actorUrl, `https://a.example/ap/outings/${pub.id}`, 'yes', 'https://d.example/ap/joins/2', deps));
    expect(dbA().select().from(invitation).where(eq(invitation.remoteActorId, z.id)).get()).toMatchObject({ status: 'yes', origin: 'remote', name: 'zoe' });
    expect(spy).toHaveBeenCalled();
    // An object from another origin is never an outing from here.
    await as(a, () => onRemoteResponse(dbA(), z.actorUrl, `https://evil.example/ap/outings/${pub.id}`, 'yes', null, deps));
    expect(countYes(dbA(), pub.id)).toBe(1);
  });

  it('copie en cache : refusée si l’objet n’est pas de l’acteur signataire, jamais écrasée par un autre ; Delete seulement par son auteur', async () => {
    const o = await newOuting({ visibility: 'public' });
    const data = (await as(a, () => eventData(dbA(), o)))!;
    const alice = upsertRemoteActor(b.db, { actorUrl: actorUrl('a.example', 'alice'), handle: 'alice', inboxUrl: 'x' });
    const mallory = upsertRemoteActor(b.db, { actorUrl: actorUrl('evil.example', 'mal'), handle: 'mal', inboxUrl: 'x' });
    expect(onEvent(b.db, mallory.actorUrl, data, [])).toBeNull(); // attributed to Alice, signed by Mallory
    expect(onEvent(b.db, mallory.actorUrl, { ...data, actorUrl: mallory.actorUrl }, [])).toBeNull(); // object hosted at Alice's
    expect(onEvent(b.db, alice.actorUrl, data, [])).toMatchObject({ created: true });
    expect(onEvent(b.db, alice.actorUrl, { ...data, title: 'v2' }, [])).toMatchObject({ created: false });
    onDeleteEvent(b.db, mallory.actorUrl, data.objectUrl);
    expect(b.db.select().from(remoteOuting).all()).toHaveLength(1);
    onDeleteEvent(b.db, alice.actorUrl, data.objectUrl);
    expect(b.db.select().from(remoteOuting).all()).toHaveLength(0);
  });

  it('Accept / Reject d’un autre acteur que l’organisateur ne change pas ma réponse', async () => {
    const { rid } = await invitePaul();
    await as(b, () => respondRemote(b.db, 'up', rid, 'yes', depsFor(b)));
    const mallory = upsertRemoteActor(b.db, { actorUrl: actorUrl('evil.example', 'mal'), handle: 'mal', inboxUrl: 'x' });
    const jid = b.db.select().from(remoteResponse).get()!.joinId!;
    expect(onJoinResult(b.db, mallory.actorUrl, `https://b.example/ap/joins/${jid}`, false, 'full')).toBe(false);
    expect(listRemoteOutings(b.db, 'up')[0].state).toBe('accepted');
  });
});

describe('envoi Fedify des sorties (#1476)', () => {
  const row = { id: 'r1', actorUrl: 'https://b.example/ap/users/paul', handle: 'paul', domain: 'b.example', displayName: 'Paul', inboxUrl: 'https://b.example/ap/users/paul/inbox', sharedInboxUrl: null, publicKeyPem: null, fetchedAt: new Date() };

  it('adressage : publique = Public + abonnés ; copains = collection privée ; sur invitation = le seul invité', async () => {
    const o = await newOuting({ visibility: 'friends' });
    const data = (await as(a, () => eventData(dbA(), o)))!;
    await as(a, async () => {
      await deliverOutingWithFedify('alice', row, { t: 'event', verb: 'Create', data, addressing: 'public' });
      await deliverOutingWithFedify('alice', row, { t: 'event', verb: 'Update', data, addressing: 'friends' });
      await deliverOutingWithFedify('alice', row, { t: 'event', verb: 'Create', data, addressing: 'invite' });
    });
    const [pub, friends, invite] = sent.map((s) => s.activity as Create);
    expect(pub).toBeInstanceOf(Create);
    expect(pub.toIds.map((u) => u.href)).toEqual([PUBLIC_COLLECTION.href]);
    expect(pub.ccIds.map((u) => u.href)).toEqual(['https://a.example/ap/users/alice/followers']);
    expect(sent[1].activity).toBeInstanceOf(Update);
    expect(friends.toIds.map((u) => u.href)).toEqual(['https://a.example/ap/users/alice/friends']);
    expect(friends.ccIds).toEqual([]);
    for (const x of [friends, invite]) {
      expect(JSON.stringify(await x.toJsonLd())).not.toContain('as:Public');
      expect(x.toIds.map((u) => u.href)).not.toContain(PUBLIC_COLLECTION.href);
    }
    expect(invite.toIds.map((u) => u.href)).toEqual(['https://b.example/ap/users/paul']);
    expect(invite.ccIds).toEqual([]);
    expect(sent[2].sender).toEqual({ identifier: 'alice' });
  });

  it('réponses et retrait : Join / TentativeAccept / Leave, Accept et Reject(Join) avec motif, Delete(Tombstone)', async () => {
    await as(b, async () => {
      const d = (to: OutingMsg) => deliverOutingWithFedify('paul', { ...row, actorUrl: 'https://a.example/ap/users/alice', inboxUrl: 'https://a.example/ap/users/alice/inbox' }, to);
      await d({ t: 'join', joinId: 'j1', objectUrl: 'https://a.example/ap/outings/o1', answer: 'yes' });
      await d({ t: 'join', joinId: 'j2', objectUrl: 'https://a.example/ap/outings/o1', answer: 'maybe' });
      await d({ t: 'join', joinId: 'j3', objectUrl: 'https://a.example/ap/outings/o1', answer: 'no' });
      await d({ t: 'join-result', joinUrl: joinUrl('j1'), accepted: false, reason: 'full' });
      await d({ t: 'join-result', joinUrl: joinUrl('j1'), accepted: true });
      await d({ t: 'delete', objectUrl: 'https://a.example/ap/outings/o1' });
    });
    const acts = sent.map((s) => s.activity);
    expect(acts[0]).toBeInstanceOf(Join);
    expect(acts[1]).toBeInstanceOf(TentativeAccept);
    expect(acts[2]).toBeInstanceOf(Leave);
    expect((acts[0] as Join).objectId?.href).toBe('https://a.example/ap/outings/o1');
    expect((acts[0] as Join).id?.href).toBe('https://b.example/ap/joins/j1');
    expect(acts[3]).toBeInstanceOf(Reject);
    expect((acts[3] as Reject).summary?.toString()).toBe('full');
    expect((acts[3] as Reject).objectId?.href).toBe('https://b.example/ap/joins/j1');
    expect(acts[4]).toBeInstanceOf(Accept);
    expect(acts[5]).toBeInstanceOf(Delete);
    expect((acts[5] as Delete).objectId?.href).toBe('https://a.example/ap/outings/o1');
  });

  it('branchement : modifier une sortie envoie un Update(Event) aux seuls invités distants (FEDERATION=on)', async () => {
    const o = await newOuting({ visibility: 'invite' });
    const paul = listInvitableFriends(dbA(), 'ua', o).find((f) => f.name.startsWith('paul'))!;
    await as(a, async () => inviteFriends(dbA(), 'ua', o, [paul.userId]));
    await vi.waitFor(() => expect(sent.length).toBe(1)); // Create vers Paul
    expect(sent[0].activity).toBeInstanceOf(Create);
    expect(await as(a, async () => updateOuting(dbA(), 'ua', o.slug, { title: 'Autre titre' }))).toEqual({ ok: true });
    await vi.waitFor(() => expect(sent.length).toBe(2));
    expect(sent[1].activity).toBeInstanceOf(Update);
    expect(sent.map((s) => s.to.id.href)).toEqual(['https://b.example/ap/users/paul', 'https://b.example/ap/users/paul']);
    vi.stubEnv('FEDERATION', 'off');
    await as(a, async () => updateOuting(dbA(), 'ua', o.slug, { title: 'Encore' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(sent.length).toBe(2); // federation off: nothing is sent
  });
});
