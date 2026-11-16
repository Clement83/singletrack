import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '@/db';
import { contact, federationBlock, federationLog, federationReport, friendship, invitation, outing, remoteActorBlock, remoteOuting, remoteResponse, user } from '@/db/schema';
import { ensureHandle } from '@/lib/federation/handle';
import { upsertRemoteActor } from '@/lib/federation/remote-actors';
import { onFollow, requestByAddress, type Outbound } from '@/lib/federation/friends';
import { onEvent, onRemoteResponse, publishOuting, listRemoteOutings, reportRemoteOuting, type EventData, type OutingMsg } from '@/lib/federation/outings';
import { remotePairKey } from '@/lib/friends';
import {
  adminEmails, allowFriendRequest, blockActor, blockDomain, cacheHasRoom, importBlockList, isAdminEmail, isDomainBlocked, LIMITS, listBlockedDomains,
  listRefusals, logRefusal, normalizeDomain, pruneRemoteOutings, screenInbox, unblockDomain,
} from '@/lib/federation/moderation';
import { _resetRateLimit } from '@/lib/outings/rate-limit';

let db: Db;
const url = (d: string, h: string) => `https://${d}/ap/users/${h}`;
const actor = (d: string, h = 'paul') => upsertRemoteActor(db, { actorUrl: url(d, h), handle: h, displayName: h, inboxUrl: `${url(d, h)}/inbox` });
const friend = (d: string, h = 'paul', uid = 'ua') => {
  const a = actor(d, h);
  db.insert(friendship).values({ requesterId: uid, addresseeId: null, remoteActorId: a.id, pairKey: remotePairKey(uid, a.id), status: 'accepted' }).run();
  return a;
};
const event = (d: string, n: number, over: Partial<EventData> = {}): EventData => ({
  objectUrl: `https://${d}/ap/outings/o${n}`, actorUrl: url(d, 'paul'), title: `Sortie ${n}`, description: null, startsAt: new Date('2099-05-10T08:00:00Z'),
  lat: 43, lon: 6, label: null, ext: { v: 1, level: 'sportif', ebike: 'yes', visibility: 'public', maxParticipants: null, yesCount: 0, status: 'planned', track: null }, ...over,
});

beforeEach(() => {
  vi.stubEnv('FEDERATION', 'on');
  vi.stubEnv('BETTER_AUTH_URL', 'https://a.example');
  _resetRateLimit();
  db = openDb(':memory:').db;
  db.insert(user).values({ id: 'ua', name: 'Alice', email: 'alice@x.test' }).run();
  ensureHandle(db, 'ua');
});
afterEach(() => vi.unstubAllEnvs());

describe('administrateur', () => {
  it('ADMIN_EMAILS : insensible à la casse, vide = personne', () => {
    const env = (v: string) => ({ ADMIN_EMAILS: v }) as unknown as NodeJS.ProcessEnv;
    expect(adminEmails(env(' A@x.fr , b@x.fr '))).toEqual(['a@x.fr', 'b@x.fr']);
    expect(isAdminEmail('B@X.fr', env('a@x.fr,b@x.fr'))).toBe(true);
    expect(isAdminEmail('c@x.fr', env('a@x.fr'))).toBe(false);
    expect(isAdminEmail('a@x.fr', env(''))).toBe(false);
    expect(isAdminEmail(null, env('a@x.fr'))).toBe(false);
  });
});

describe('serveur bloqué', () => {
  it('normalise le domaine et bloque aussi les sous-domaines', () => {
    expect(normalizeDomain(' HTTPS://Evil.Example/path ')).toBe('evil.example');
    expect(normalizeDomain('*.evil.example')).toBe('evil.example');
    expect(normalizeDomain('pas un domaine')).toBeNull();
    expect(normalizeDomain(42)).toBeNull();
    blockDomain(db, 'evil.example');
    expect(isDomainBlocked(db, 'evil.example')).toBe(true);
    expect(isDomainBlocked(db, 'x.evil.example:8443')).toBe(true);
    expect(isDomainBlocked(db, 'notevil.example')).toBe(false);
    expect(unblockDomain(db, 'evil.example')).toBe(true);
    expect(isDomainBlocked(db, 'evil.example')).toBe(false);
  });

  it('bloquer retire copains, sorties en cache, invitations et liens de carnet de ce serveur, pas ceux des autres', () => {
    const bad = friend('evil.example');
    const ok = friend('good.example');
    onEvent(db, bad.actorUrl, event('evil.example', 1), []);
    onEvent(db, ok.actorUrl, event('good.example', 1), []);
    db.insert(contact).values({ ownerUserId: 'ua', name: 'Paul', remoteActorId: bad.id }).run();
    blockDomain(db, 'evil.example', 'spam');
    expect(db.select().from(friendship).all().map((f) => f.remoteActorId)).toEqual([ok.id]);
    expect(db.select().from(remoteOuting).all().map((o) => o.remoteActorId)).toEqual([ok.id]);
    expect(db.select().from(contact).get()?.remoteActorId).toBeNull();
  });

  it('rien n’est accepté : sortie, réponse et Follow d’un serveur bloqué sont ignorés', async () => {
    const a = actor('evil.example');
    blockDomain(db, 'evil.example');
    expect(onEvent(db, a.actorUrl, event('evil.example', 1), [])).toBeNull();
    expect(db.select().from(remoteOuting).all()).toHaveLength(0);
    await onFollow(db, a.actorUrl, 'alice', 'https://evil.example/ap/follows/f1', { resolve: async () => null, deliver: async () => {} });
    expect(db.select().from(friendship).all()).toHaveLength(0);
  });

  it('rien n’est envoyé : demande d’ami sans résolution réseau, et plus aucune publication vers un serveur bloqué', async () => {
    const resolve = vi.fn(async () => null);
    const deliver = vi.fn(async () => {});
    blockDomain(db, 'evil.example');
    expect(await requestByAddress(db, 'ua', 'paul@evil.example', { resolve, deliver })).toEqual({ ok: true });
    expect(resolve).not.toHaveBeenCalled();
    // un copain déjà là (cas d'un blocage posé hors purge) ne reçoit plus rien ; un autre serveur reçoit toujours
    friend('b.example');
    friend('c.example', 'zed');
    db.insert(outing).values({ id: 'o1', slug: 's1', title: 'T', startsAt: new Date('2099-01-01'), meetingLat: 1, meetingLon: 1, ownerId: 'ua', createdBy: 'ua', visibility: 'public', trackSnapshot: {} } as never).run();
    db.insert(federationBlock).values({ domain: 'b.example' }).run();
    const sent: string[] = [];
    await publishOuting(db, 'o1', 'Create', { deliver: async (_h, to) => { sent.push(to.domain); } });
    expect(sent).toEqual(['c.example']);
  });

  it('import CSV Mastodon : suspend seulement, domaines masqués et silence ignorés, idempotent', () => {
    const csv = '#domain,#severity,#reject_media,#reject_reports,#public_comment,#obfuscate\nspam.example,suspend,false,false,Spam,false\nmeh.example,silence,false,false,,false\nbad*.example,suspend,false,false,,true\n\nOther.Example,suspend,,,,\n';
    expect(importBlockList(db, csv)).toEqual({ added: 2, skipped: 2 });
    expect(listBlockedDomains(db).map((b) => [b.domain, b.source])).toEqual([['other.example', 'import'], ['spam.example', 'import']]);
    expect(importBlockList(db, csv).added).toBe(0);
    expect(importBlockList(db, 'solo.example\n').added).toBe(1); // sans en-tête : une colonne
  });
});

describe('compte bloqué par un utilisateur', () => {
  it('retire l’amitié et les réponses ; ses sorties ne sont plus listées ; ses invitations n’arrivent plus', () => {
    const p = friend('b.example');
    const r = onEvent(db, p.actorUrl, event('b.example', 1), [])!;
    db.insert(remoteResponse).values({ remoteOutingId: r.id, userId: 'ua', answer: 'yes' }).run();
    expect(listRemoteOutings(db, 'ua')).toHaveLength(1);
    expect(blockActor(db, 'ua', p.id)).toBe(true);
    expect(blockActor(db, 'ua', 'inconnu')).toBe(false);
    expect(db.select().from(friendship).all()).toHaveLength(0);
    expect(db.select().from(remoteResponse).all()).toHaveLength(0);
    expect(listRemoteOutings(db, 'ua')).toHaveLength(0);
    expect(db.select().from(remoteActorBlock).all()).toHaveLength(1);
    // invitation « sur invitation » : pas de ligne de réponse pour l'invité
    const sent: string[] = [];
    onEvent(db, p.actorUrl, event('b.example', 2, { ext: { ...event('b.example', 2).ext, visibility: 'invite' } }), ['alice'], async (m) => { sent.push(m.to); });
    expect(db.select().from(remoteResponse).all()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('un compte bloqué ne peut plus demander d’ami (Follow ignoré, rien n’est créé)', async () => {
    const p = actor('b.example');
    blockActor(db, 'ua', p.id);
    await onFollow(db, p.actorUrl, 'alice', 'https://b.example/ap/follows/f', { resolve: async () => null, deliver: async () => {} });
    expect(db.select().from(friendship).all()).toHaveLength(0);
  });

  it('ses Join sur mes sorties sont ignorés', async () => {
    db.insert(outing).values({ id: 'o1', slug: 's1', title: 'T', startsAt: new Date('2099-01-01'), meetingLat: 1, meetingLon: 1, ownerId: 'ua', createdBy: 'ua', visibility: 'public', trackSnapshot: {} } as never).run();
    const p = actor('b.example');
    blockActor(db, 'ua', p.id);
    const deliver = vi.fn(async () => {});
    await onRemoteResponse(db, p.actorUrl, 'https://a.example/ap/outings/o1', 'yes', 'https://b.example/ap/joins/j', { deliver });
    expect(db.select().from(invitation).all()).toHaveLength(0);
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('limites', () => {
  it('boîte d’entrée : trop grosse (413), serveur bloqué (403), débit par serveur (429), Delete d’un inconnu ignoré (202)', () => {
    const body = (d: string, type = 'Create') => ({ type, actor: url(d, 'paul') });
    expect(screenInbox(db, { size: LIMITS.maxActivityBytes + 1, body: body('x.example') })).toMatchObject({ ok: false, status: 413, reason: 'too_large' });
    blockDomain(db, 'evil.example');
    expect(screenInbox(db, { size: 100, body: body('evil.example') })).toMatchObject({ ok: false, status: 403, reason: 'blocked' });
    expect(screenInbox(db, { size: 100, body: body('new.example', 'Delete') })).toMatchObject({ ok: false, status: 202 });
    actor('known.example');
    expect(screenInbox(db, { size: 100, body: body('known.example', 'Delete') }).ok).toBe(true);
    const t = 1_000_000;
    for (let i = 0; i < LIMITS.ratePerMinute; i++) expect(screenInbox(db, { size: 10, body: body('busy.example') }, t).ok).toBe(true);
    expect(screenInbox(db, { size: 10, body: body('busy.example') }, t)).toMatchObject({ ok: false, status: 429, reason: 'rate_limit' });
    expect(screenInbox(db, { size: 10, body: body('calm.example') }, t).ok).toBe(true); // l'autre serveur n'est pas touché
    expect(screenInbox(db, { size: 10, body: body('busy.example') }, t + 61_000).ok).toBe(true); // nouvelle fenêtre
    expect(screenInbox(db, { size: 10, body: null }).ok).toBe(true); // Fedify refusera (pas d'acteur)
  });

  it('cache : 200 sorties par serveur au plus (les mises à jour passent), expiration à 30 jours', () => {
    const p = actor('b.example');
    const now = new Date('2099-01-01T00:00:00Z');
    for (let i = 0; i < LIMITS.maxCachedOutingsPerServer; i++) {
      db.insert(remoteOuting).values({ objectUrl: `https://b.example/ap/outings/${i}`, remoteActorId: p.id, title: 't', startsAt: new Date('2099-06-01'), meetingLat: 1, meetingLon: 1, fetchedAt: now, updatedAt: now }).run();
    }
    expect(cacheHasRoom(db, p.id)).toBe(false);
    expect(onEvent(db, p.actorUrl, event('b.example', 9999), [], undefined, now)).toBeNull();
    expect(listRefusals(db)[0]).toMatchObject({ domain: 'b.example', reason: 'cache_full' });
    expect(onEvent(db, p.actorUrl, event('b.example', 0, { objectUrl: 'https://b.example/ap/outings/0', startsAt: new Date('2099-06-02') }), [], undefined, now)).toMatchObject({ created: false });
    db.update(remoteOuting).set({ startsAt: new Date('2098-11-01') }).where(eq(remoteOuting.objectUrl, 'https://b.example/ap/outings/1')).run();
    expect(pruneRemoteOutings(db, now)).toBe(1);
    expect(cacheHasRoom(db, p.id)).toBe(true);
  });

  it('demandes de copain d’un serveur jamais vu : 5 par jour et par destinataire ; un serveur connu n’est pas limité', async () => {
    const deps = { resolve: async () => null, deliver: async (): Promise<void> => {} };
    for (let i = 0; i < 7; i++) {
      const p = actor(`s${i}.example`, `u${i}`);
      await onFollow(db, p.actorUrl, 'alice', `https://s${i}.example/ap/follows/f`, deps);
    }
    expect(db.select().from(friendship).all()).toHaveLength(LIMITS.unseenServerRequestsPerDay);
    expect(listRefusals(db).filter((r) => r.reason === 'friend_quota')).toHaveLength(2);
    friend('known.example');
    const p = actor('known.example', 'autre');
    await onFollow(db, p.actorUrl, 'alice', 'https://known.example/ap/follows/g', deps);
    expect(db.select().from(friendship).all()).toHaveLength(LIMITS.unseenServerRequestsPerDay + 2);
    expect(allowFriendRequest(db, 'ua', 'nouveau.example')).toBe(false);
    expect(allowFriendRequest(db, 'ua', 'nouveau.example', new Date(Date.now() + 2 * 86_400_000))).toBe(true); // le lendemain
  });
});

describe('journal des refus', () => {
  it('garde les plus récents, sans contenu', () => {
    for (let i = 0; i < LIMITS.logKeep + 150; i++) logRefusal(db, { domain: 'x.example', reason: 'rate_limit', activity: 'Create' }, new Date(1_700_000_000_000 + i * 1000));
    const n = db.select().from(federationLog).all().length;
    expect(n).toBeLessThanOrEqual(LIMITS.logKeep + 100);
    expect(listRefusals(db, 1)[0].at.getTime()).toBe(1_700_000_000_000 + (LIMITS.logKeep + 149) * 1000);
    expect(Object.keys(listRefusals(db, 1)[0]).sort()).toEqual(['activity', 'at', 'domain', 'id', 'reason']);
  });
});

describe('signalement', () => {
  it('copie pour l’admin (une fois) + Flag envoyé au serveur d’origine', async () => {
    const p = friend('b.example');
    const r = onEvent(db, p.actorUrl, event('b.example', 1), [])!;
    const log: OutingMsg[] = [];
    const deliver = async (_h: string, _to: unknown, m: OutingMsg) => { log.push(m); };
    expect(await reportRemoteOuting(db, 'ua', r.id, 'x'.repeat(900), { deliver })).toEqual({ ok: true });
    expect(await reportRemoteOuting(db, 'ua', r.id, 'encore', { deliver })).toEqual({ ok: true });
    expect(log).toEqual([{ t: 'flag', objectUrl: 'https://b.example/ap/outings/o1', reason: 'x'.repeat(500) }]);
    const rows = db.select().from(federationReport).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ domain: 'b.example', title: 'Sortie 1', reporterId: 'ua' });
    expect(await reportRemoteOuting(db, 'ua', 'inconnue', null, { deliver })).toEqual({ ok: false, error: 'not_found' });
    expect(await reportRemoteOuting(db, 'ua', r.id, 42, { deliver })).toEqual({ ok: false, error: 'invalid' });
  });

  it('un Flag ne part pas vers un serveur bloqué (la copie reste pour l’admin)', async () => {
    const p = friend('b.example');
    const r = onEvent(db, p.actorUrl, event('b.example', 1), [])!;
    db.insert(federationReport).values({ reporterId: null, objectUrl: 'x', domain: 'x', title: 'x' }).run();
    const deliver = vi.fn(async () => {});
    blockDomain(db, 'b.example');
    expect(await reportRemoteOuting(db, 'ua', r.id, null, { deliver })).toEqual({ ok: false, error: 'not_found' }); // sortie retirée par le blocage
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('type Outbound', () => { it('reste importable', () => { const o: Outbound = { t: 'undo', followId: 'x' }; expect(o.t).toBe('undo'); }); });
