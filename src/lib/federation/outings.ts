import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Temporal } from '@js-temporal/polyfill';
import { Accept, Create, Delete, Document, Event, Flag, Join, Leave, Place, PUBLIC_COLLECTION, Reject, TentativeAccept, Tombstone, Update } from '@fedify/vocab';
import type { Db } from '@/db';
import {
  federationReport, invitation, outing, remoteActor, remoteActorBlock, remoteOuting, remoteResponse, user,
  OUTING_EBIKE, OUTING_LEVELS, OUTING_STATUS, OUTING_VISIBILITIES, type OutingRow,
} from '@/db/schema';
import { simplifyGeometry } from '@/lib/geo';
import { isRemoteFriend, remoteFriendActorIds } from '@/lib/friends';
import { sendInBackground, sendMail, type Mailer } from '@/lib/mail';
import { friendInviteMail } from '@/lib/mail-templates';
import { formatOutingDate } from '@/lib/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/config';
import { countYes, isClosed } from '@/lib/outings/service';
import { newInviteToken } from '@/lib/outings/tokens';
import type { TrackSnapshot } from '@/lib/outings/snapshot';
import { federationEnabled, publicOrigin } from './config';
import { getFederation } from './index';
import { getHandle, userIdByHandle } from './handle';
import { getRemoteActor } from './remote-actors';
import { cacheHasRoom, isActorBlocked, isDomainBlocked, logRefusal, pruneRemoteOutings } from './moderation';

/**
 * Sorties entre serveurs (#1476, docs/federation.md §5 « Sorties » et §10). **Le serveur de l'organisateur reste la
 * référence** (réponses, places, statut) ; les autres gardent une copie en cache (`remote_outing`).
 *
 * - objet : `Event` (`name`, `content`, `startTime`, `location` = `Place` lat/lon) + une pièce jointe `singletrack:outing`
 *   (JSON dans une URL `data:`) qui porte ce que le vocabulaire ActivityStreams n'a pas : trace figée (GeoJSON simplifié, stats,
 *   attribution, licence), places, niveau, VAE, statut, nombre de « je viens » ;
 * - adressage : publique = `Public` ; copains = collection privée `friends` (jamais énumérable) ; sur invitation = **seulement**
 *   le serveur de chaque copain distant invité (une activité par invité, jamais de liste des autres) ;
 * - réponses d'un distant : `Join` (je viens) / `TentativeAccept` (peut-être) / `Leave` (non) → `Accept` / `Reject(Join)` (motif en `summary`) ;
 * - ne part jamais : `/i/<token>`, invités sans compte, carnet de potes, emails, brouillons, slug de la trace.
 * La logique est ici sans réseau : elle produit des messages (`OutingMsg`, données brutes) pour un `OutingDeliver` injectable (tests).
 */

export type Addressing = 'public' | 'friends' | 'invite';
type ActorRow = typeof remoteActor.$inferSelect;

/** Ce que l'`Event` porte au-delà d'ActivityStreams. */
export type OutingExt = {
  v: 1;
  level: OutingRow['level'];
  ebike: OutingRow['ebike'];
  visibility: OutingRow['visibility'];
  maxParticipants: number | null;
  yesCount: number;
  status: OutingRow['status'];
  track: TrackSnapshot | null;
};

export type EventData = {
  objectUrl: string;
  actorUrl: string;
  title: string;
  description: string | null;
  startsAt: Date;
  lat: number;
  lon: number;
  label: string | null;
  ext: OutingExt;
};

export type OutingMsg =
  | { t: 'event'; verb: 'Create' | 'Update'; data: EventData; addressing: Addressing }
  | { t: 'delete'; objectUrl: string }
  | { t: 'join'; joinId: string; objectUrl: string; answer: 'yes' | 'maybe' | 'no' }
  | { t: 'join-result'; joinUrl: string; accepted: boolean; reason?: string }
  | { t: 'flag'; objectUrl: string; reason: string | null };
export type OutingDeliver = (handle: string, to: ActorRow, msg: OutingMsg) => Promise<void>;

export const outingObjectUrl = (id: string) => `${publicOrigin()}/ap/outings/${id}`;
export const joinUrl = (id: string) => `${publicOrigin()}/ap/joins/${id}`;
export const friendsCollectionUrl = (handle: string) => `${publicOrigin()}/ap/users/${handle}/friends`;
const OUTING_PATH = /^\/ap\/outings\/([A-Za-z0-9-]+)$/;
const JOIN_PATH = /^\/ap\/joins\/([A-Za-z0-9-]+)$/;

/** Identifiant d'une sortie **de cette instance** désignée par l'URL de son `Event`, sinon null (autre origine, autre chemin). */
export function localOutingId(url: string | null | undefined): string | null {
  try {
    const u = new URL(url ?? '');
    return u.origin === publicOrigin() ? OUTING_PATH.exec(u.pathname)?.[1] ?? null : null;
  } catch { return null; }
}
export function localJoinId(url: string | null | undefined): string | null {
  try {
    const u = new URL(url ?? '');
    return u.origin === publicOrigin() ? JOIN_PATH.exec(u.pathname)?.[1] ?? null : null;
  } catch { return null; }
}

/** Qui organise : le propriétaire, sinon (publique figée) celui qui l'a proposée. */
export const organizerOf = (o: Pick<OutingRow, 'ownerId' | 'createdBy'>) => o.ownerId ?? o.createdBy;

// ───────────────────────── Sérialisation de l'Event ─────────────────────────

const MAX_EXT_BYTES = 600_000;
const DATA_PREFIX = 'data:application/json;base64,';
export const EXT_NAME = 'singletrack:outing';

/** Trace pour l'envoi : sans le slug (lien secret `/t/<uuid>` de l'organisateur), simplifiée davantage si la charge est grosse. */
function exportExt(ext: OutingExt): string {
  let json = '';
  for (const tol of [5, 10, 20, 40, 80]) {
    const track = ext.track ? { ...ext.track, slug: '', geometry: tol === 5 ? ext.track.geometry : simplifyGeometry(ext.track.geometry, tol) } : null;
    json = JSON.stringify({ ...ext, track });
    if (json.length <= MAX_EXT_BYTES) break;
  }
  return `${DATA_PREFIX}${Buffer.from(json).toString('base64')}`;
}

export function buildEvent(data: EventData, addressing: { to: URL[]; cc?: URL[] }): Event {
  return new Event({
    id: new URL(data.objectUrl),
    attribution: new URL(data.actorUrl),
    name: data.title,
    content: data.description,
    startTime: Temporal.Instant.fromEpochMilliseconds(data.startsAt.getTime()),
    location: new Place({ name: data.label, latitude: data.lat, longitude: data.lon }),
    attachments: [new Document({ name: EXT_NAME, mediaType: 'application/json', url: new URL(exportExt(data.ext)) })],
    tos: addressing.to,
    ccs: addressing.cc ?? [],
  });
}

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list as readonly string[]).includes(v as string) ? (v as T) : fallback;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function sanitizeTrack(raw: unknown): TrackSnapshot | null {
  const t = raw as Partial<TrackSnapshot> | null;
  const g = t?.geometry as { type?: unknown; coordinates?: unknown } | undefined;
  if (!t || !g || (g.type !== 'LineString' && g.type !== 'MultiLineString') || !Array.isArray(g.coordinates)) return null;
  const lines = (g.type === 'LineString' ? [g.coordinates] : g.coordinates) as unknown[];
  let points = 0;
  for (const line of lines) {
    if (!Array.isArray(line)) return null;
    for (const p of line) {
      if (!Array.isArray(p) || p.length < 2 || p.length > 3 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
      if (++points > 100_000) return null;
    }
  }
  const bbox = Array.isArray(t.bbox) && t.bbox.length === 4 && t.bbox.every((n) => num(n) != null) ? (t.bbox as TrackSnapshot['bbox']) : null;
  const start = Array.isArray(t.start) && t.start.length === 2 && t.start.every((n) => num(n) != null) ? (t.start as [number, number]) : null;
  if (!bbox || !start || num(t.distanceM) == null) return null;
  return {
    slug: '', name: str(t.name, 120) ?? '', geometry: g as TrackSnapshot['geometry'], bbox, start,
    distanceM: t.distanceM as number, elevationGainM: num(t.elevationGainM), elevationLossM: num(t.elevationLossM),
    minEle: num(t.minEle), maxEle: num(t.maxEle),
    difficulty: (['green', 'blue', 'red', 'black'] as const).find((d) => d === t.difficulty) ?? null,
    loop: t.loop === true, source: oneOf(['utagawa', 'osm', 'geotrek', 'gpx', 'manual', 'edited'] as const, t.source, 'gpx'),
    license: str(t.license, 200), attribution: str(t.attribution, 300), author: str(t.author, 120), sourceUrl: str(t.sourceUrl, 500),
    takenAt: str(t.takenAt, 40) ?? new Date().toISOString(),
  };
}

/** Lit l'extension `singletrack:outing` ; valeurs hors énumération ramenées au défaut, rien n'est exécuté ni suivi. */
export function parseExt(href: string | null | undefined): OutingExt | null {
  if (!href || !href.startsWith(DATA_PREFIX) || href.length > MAX_EXT_BYTES * 1.4) return null;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(Buffer.from(href.slice(DATA_PREFIX.length), 'base64').toString('utf8')); } catch { return null; }
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  const max = num(raw.maxParticipants);
  return {
    v: 1,
    level: oneOf(OUTING_LEVELS, raw.level, 'sportif'),
    ebike: oneOf(OUTING_EBIKE, raw.ebike, 'yes'),
    visibility: oneOf(OUTING_VISIBILITIES, raw.visibility, 'invite'),
    maxParticipants: max != null && max >= 1 && max <= 500 ? Math.floor(max) : null,
    yesCount: Math.min(Math.max(Math.floor(num(raw.yesCount) ?? 0), 0), 10_000),
    status: oneOf(OUTING_STATUS, raw.status, 'planned'),
    track: sanitizeTrack(raw.track),
  };
}

/** `Event` Fedify → données (null si incomplet : date, lieu ou identifiant manquant). */
export async function parseEvent(ev: Event): Promise<EventData | null> {
  const id = ev.id?.href;
  const actor = ev.attributionId?.href;
  const title = str(ev.name?.toString(), 120);
  const start = ev.startTime;
  const place = await ev.getLocation();
  if (!id || !actor || !title || !start || !(place instanceof Place)) return null;
  const lat = place.latitude, lon = place.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  let ext: OutingExt | null = null;
  for await (const a of ev.getAttachments()) {
    if (a instanceof Document && a.name?.toString() === EXT_NAME) { ext = parseExt(a.url instanceof URL ? a.url.href : a.url?.href?.href); break; }
  }
  return {
    objectUrl: id, actorUrl: actor, title, description: str(ev.content?.toString(), 2000),
    startsAt: new Date(start.epochMilliseconds), lat, lon, label: str(place.name?.toString(), 120),
    ext: ext ?? { v: 1, level: 'sportif', ebike: 'yes', visibility: 'invite', maxParticipants: null, yesCount: 0, status: 'planned', track: null },
  };
}

// ───────────────────────── Côté organisateur ─────────────────────────

export function eventData(db: Db, o: OutingRow): EventData | null {
  const org = organizerOf(o);
  const handle = org ? getHandle(db, org).handle : null;
  if (!handle) return null;
  return {
    objectUrl: outingObjectUrl(o.id), actorUrl: `${publicOrigin()}/ap/users/${handle}`,
    title: o.title, description: o.description, startsAt: o.startsAt, lat: o.meetingLat, lon: o.meetingLon, label: o.meetingLabel,
    ext: { v: 1, level: o.level, ebike: o.ebike, visibility: o.visibility, maxParticipants: o.maxParticipants, yesCount: countYes(db, o.id), status: o.status, track: o.trackSnapshot },
  };
}

/** Serveurs destinataires : copains distants de l'organisateur (publique, copains) et invités distants (toutes visibilités). */
export function recipientsOf(db: Db, o: OutingRow): ActorRow[] {
  const org = organizerOf(o);
  if (!org) return [];
  const ids = new Set(
    db.select({ r: invitation.remoteActorId }).from(invitation).where(and(eq(invitation.outingId, o.id), isNull(invitation.revokedAt))).all().flatMap((r) => (r.r ? [r.r] : [])),
  );
  // Sur invitation : **seulement** les invités. Un copain non invité ne reçoit rien.
  if (o.visibility !== 'invite') for (const id of remoteFriendActorIds(db, org)) ids.add(id);
  return ids.size ? db.select().from(remoteActor).where(inArray(remoteActor.id, [...ids])).all() : [];
}

export type OutingFedDeps = { deliver: OutingDeliver };

async function send(db: Db, deps: OutingFedDeps, handle: string, to: ActorRow, msg: OutingMsg) {
  if (!federationEnabled() || isDomainBlocked(db, to.domain)) return; // un serveur bloqué ne reçoit rien
  try { await deps.deliver(handle, to, msg); } catch (e) { console.warn('[federation] envoi sortie', msg.t, e instanceof Error ? e.message : e); }
}

/** `Create` / `Update(Event)` d'une sortie vers tous ses destinataires (adressage selon la visibilité). */
export async function publishOuting(db: Db, outingId: string, verb: 'Create' | 'Update', deps: OutingFedDeps = defaultOutingDeps): Promise<void> {
  const o = db.select().from(outing).where(eq(outing.id, outingId)).get();
  const data = o && eventData(db, o);
  if (!o || !data) return;
  const handle = getHandle(db, organizerOf(o)!).handle!;
  for (const to of recipientsOf(db, o)) await send(db, deps, handle, to, { t: 'event', verb, data, addressing: o.visibility });
}

/** `Create` vers ces copains distants seulement (invitation « sur invitation » : le serveur de chaque invité, personne d'autre). */
export async function publishToActors(db: Db, outingId: string, remoteActorIds: string[], deps: OutingFedDeps = defaultOutingDeps): Promise<void> {
  const o = db.select().from(outing).where(eq(outing.id, outingId)).get();
  const data = o && eventData(db, o);
  if (!o || !data || !remoteActorIds.length) return;
  const handle = getHandle(db, organizerOf(o)!).handle!;
  for (const to of db.select().from(remoteActor).where(inArray(remoteActor.id, remoteActorIds)).all()) await send(db, deps, handle, to, { t: 'event', verb: 'Create', data, addressing: 'invite' });
}

/** Retrait d'un invité distant : `Delete(Event)` vers son seul serveur. */
export async function retractFromActor(db: Db, outingId: string, remoteActorId: string, deps: OutingFedDeps = defaultOutingDeps): Promise<void> {
  const o = db.select().from(outing).where(eq(outing.id, outingId)).get();
  const to = db.select().from(remoteActor).where(eq(remoteActor.id, remoteActorId)).get();
  const handle = o && organizerOf(o) ? getHandle(db, organizerOf(o)!).handle : null;
  if (o && to && handle) await send(db, deps, handle, to, { t: 'delete', objectUrl: outingObjectUrl(o.id) });
}

/**
 * `Join` / `TentativeAccept` / `Leave` d'un compte distant sur une sortie de cette instance. Mêmes règles que pour un compte local
 * (visibilité, sortie close, places). Hors droits : silence (on ne confirme pas l'existence de la sortie).
 * Réponse : `Accept` / `Reject` (motif `full` / `closed` / `forbidden`) puis `Update(Event)` à ce seul serveur (état à jour).
 */
export async function onRemoteResponse(
  db: Db, actorUrl: string, objectUrl: string | null, answer: 'yes' | 'maybe' | 'no', joinUrlStr: string | null, deps: OutingFedDeps = defaultOutingDeps,
): Promise<void> {
  const actor = getRemoteActor(db, actorUrl);
  const id = localOutingId(objectUrl);
  const o = id ? db.select().from(outing).where(eq(outing.id, id)).get() : undefined;
  const org = o && organizerOf(o);
  const handle = org ? getHandle(db, org).handle : null;
  if (!actor || !o || !org || !handle) return;
  if (isDomainBlocked(db, actor.domain) || isActorBlocked(db, org, actor.id)) return;

  const mine = db.select().from(invitation).where(and(eq(invitation.outingId, o.id), eq(invitation.remoteActorId, actor.id))).get();
  const allowed = o.visibility === 'public' || !!mine || (o.visibility === 'friends' && remoteFriendActorIds(db, org).includes(actor.id));
  if (!allowed) return;
  const reply = async (accepted: boolean, reason?: string) => {
    if (joinUrlStr) await send(db, deps, handle, actor, { t: 'join-result', joinUrl: joinUrlStr, accepted, reason });
    const data = eventData(db, o);
    if (data) await send(db, deps, handle, actor, { t: 'event', verb: 'Update', data: { ...data, ext: { ...data.ext, yesCount: countYes(db, o.id) } }, addressing: o.visibility });
  };
  if (mine?.revokedAt) return reply(false, 'forbidden');
  if (isClosed(o)) return reply(false, 'closed');
  if (answer === 'yes' && mine?.status !== 'yes' && o.maxParticipants != null && countYes(db, o.id, mine?.id) >= o.maxParticipants) return reply(false, 'full');

  const now = new Date();
  if (mine) {
    db.update(invitation).set({ status: answer, respondedAt: now, updatedAt: now }).where(eq(invitation.id, mine.id)).run();
  } else if (answer !== 'no') {
    const { tokenHash } = newInviteToken();
    db.insert(invitation).values({
      outingId: o.id, tokenHash, tokenEnc: null, remoteActorId: actor.id, name: (actor.displayName || actor.handle).slice(0, 60),
      origin: 'remote', status: answer, respondedAt: now,
    }).run();
  }
  await reply(true);
}

// ───────────────────────── Côté invité (cache de sorties distantes) ─────────────────────────

const baseUrl = () => (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '');

/**
 * `Create` / `Update(Event)` reçu : met la copie en cache à jour. Refusé si l'objet n'est pas de l'acteur signataire ou d'un autre
 * hôte que lui. `localHandles` = comptes de cette instance nommés dans `to` : pour une invitation (« sur invitation »), seuls ceux
 * qui sont copains de l'organisateur sont retenus (pas d'invitation d'un inconnu) et reçoivent un mail.
 */
export function onEvent(
  db: Db, actorUrl: string, data: EventData, localHandles: string[], mailer: Mailer = sendMail, now = new Date(),
): { id: string; created: boolean } | null {
  const actor = getRemoteActor(db, actorUrl);
  if (!actor || data.actorUrl !== actor.actorUrl || new URL(data.objectUrl).host !== new URL(actor.actorUrl).host) return null;
  const e = data.ext;
  const values = {
    remoteActorId: actor.id, title: data.title, description: data.description, startsAt: data.startsAt,
    meetingLat: data.lat, meetingLon: data.lon, meetingLabel: data.label, level: e.level, ebike: e.ebike,
    track: e.track, status: e.status, visibility: e.visibility, maxParticipants: e.maxParticipants, yesCount: e.yesCount, updatedAt: now,
  };
  const existing = db.select().from(remoteOuting).where(eq(remoteOuting.objectUrl, data.objectUrl)).get();
  // Une sortie appartient à son organisateur : un autre acteur ne la modifie pas.
  if (existing && existing.remoteActorId !== actor.id) return null;
  if (isDomainBlocked(db, actor.domain)) return null;
  pruneRemoteOutings(db, now);
  // Plafond de copies par serveur : une nouvelle sortie au-delà est refusée (les mises à jour passent).
  if (!existing && !cacheHasRoom(db, actor.id)) { logRefusal(db, { domain: actor.domain, reason: 'cache_full', activity: 'Create' }); return null; }
  let id = existing?.id;
  if (existing) db.update(remoteOuting).set(values).where(eq(remoteOuting.id, existing.id)).run();
  else id = db.insert(remoteOuting).values({ ...values, objectUrl: data.objectUrl, fetchedAt: now }).returning({ id: remoteOuting.id }).get().id;

  if (e.visibility === 'invite') {
    for (const h of localHandles) {
      const uid = userIdByHandle(db, h);
      if (!uid || !isRemoteFriend(db, uid, actor.actorUrl) || isActorBlocked(db, uid, actor.id)) continue;
      const had = db.select().from(remoteResponse).where(and(eq(remoteResponse.remoteOutingId, id!), eq(remoteResponse.userId, uid))).get();
      if (had) continue;
      db.insert(remoteResponse).values({ remoteOutingId: id!, userId: uid }).run();
      const u = db.select({ email: user.email, locale: user.locale }).from(user).where(eq(user.id, uid)).get();
      if (u) {
        const locale = isLocale(u.locale) ? u.locale : DEFAULT_LOCALE;
        sendInBackground(mailer, friendInviteMail(u.email, {
          inviter: actor.displayName || actor.handle, title: data.title, date: formatOutingDate(data.startsAt, locale), url: `${baseUrl()}/sorties/distante/${id}`,
        }, locale));
      }
    }
  }
  return { id: id!, created: !existing };
}

/** `Delete(Event)` : l'organisateur retire la sortie (ou m'en retire). Appliqué au mieux, uniquement par son propre acteur. */
export function onDeleteEvent(db: Db, actorUrl: string, objectUrl: string | null): void {
  const actor = getRemoteActor(db, actorUrl);
  if (!actor || !objectUrl) return;
  db.delete(remoteOuting).where(and(eq(remoteOuting.objectUrl, objectUrl), eq(remoteOuting.remoteActorId, actor.id))).run();
}

/** `Accept` / `Reject(Join)` de l'organisateur : l'état de ma réponse (acceptée, ou refusée avec son motif). */
export function onJoinResult(db: Db, actorUrl: string, joinUrlStr: string | null, accepted: boolean, reason: string | null): boolean {
  const actor = getRemoteActor(db, actorUrl);
  const jid = localJoinId(joinUrlStr);
  if (!actor || !jid) return false;
  const row = db.select({ r: remoteResponse }).from(remoteResponse).innerJoin(remoteOuting, eq(remoteOuting.id, remoteResponse.remoteOutingId))
    .where(and(eq(remoteResponse.joinId, jid), eq(remoteOuting.remoteActorId, actor.id))).get();
  if (!row) return false;
  const r = reason === 'full' || reason === 'closed' || reason === 'forbidden' ? reason : null;
  db.update(remoteResponse).set({ state: accepted ? 'accepted' : 'rejected', reason: accepted ? null : r, updatedAt: new Date() })
    .where(and(eq(remoteResponse.remoteOutingId, row.r.remoteOutingId), eq(remoteResponse.userId, row.r.userId))).run();
  return true;
}

const GRACE_MS = 6 * 3600_000;

export type RemoteOutingView = {
  id: string; title: string; description: string | null; startsAt: Date; lat: number; lon: number; label: string | null;
  level: OutingRow['level']; ebike: OutingRow['ebike']; status: OutingRow['status']; visibility: OutingRow['visibility'];
  maxParticipants: number | null; yesCount: number; spotsLeft: number | null; closed: boolean; track: TrackSnapshot | null;
  organizer: { actorId: string; name: string; handle: string; domain: string; profileUrl: string };
  /** Invité (réponse attendue) / ma réponse / état côté serveur de l'organisateur. */
  invited: boolean; answer: 'pending' | 'yes' | 'maybe' | 'no'; state: 'none' | 'sent' | 'accepted' | 'rejected'; reason: string | null;
};

/** Visible de ce compte : publique ; sinon j'ai une ligne de réponse (invité) ou (copains) je suis copain de l'organisateur. */
export function listRemoteOutings(db: Db, userId: string, opts: { id?: string; now?: Date } = {}): RemoteOutingView[] {
  const now = opts.now ?? new Date();
  const friends = new Set(remoteFriendActorIds(db, userId));
  const blocked = new Set(db.select({ id: remoteActorBlock.remoteActorId }).from(remoteActorBlock).where(eq(remoteActorBlock.userId, userId)).all().map((b) => b.id));
  const mine = new Map(db.select().from(remoteResponse).where(eq(remoteResponse.userId, userId)).all().map((r) => [r.remoteOutingId, r]));
  const rows = db.select({ o: remoteOuting, a: remoteActor }).from(remoteOuting).innerJoin(remoteActor, eq(remoteActor.id, remoteOuting.remoteActorId))
    .where(opts.id ? eq(remoteOuting.id, opts.id) : undefined).orderBy(desc(remoteOuting.startsAt)).all();
  return rows
    .filter(({ o }) => !blocked.has(o.remoteActorId))
    .filter(({ o }) => o.visibility === 'public' || mine.has(o.id) || (o.visibility === 'friends' && friends.has(o.remoteActorId)))
    .map(({ o, a }): RemoteOutingView => {
      const r = mine.get(o.id);
      return {
        id: o.id, title: o.title, description: o.description, startsAt: o.startsAt, lat: o.meetingLat, lon: o.meetingLon, label: o.meetingLabel,
        level: o.level, ebike: o.ebike, status: o.status, visibility: o.visibility, maxParticipants: o.maxParticipants, yesCount: o.yesCount,
        spotsLeft: o.maxParticipants == null ? null : Math.max(0, o.maxParticipants - o.yesCount),
        closed: isClosed(o, now), track: o.track,
        organizer: { actorId: a.id, name: a.displayName || a.handle, handle: a.handle, domain: a.domain, profileUrl: a.actorUrl },
        invited: !!r, answer: r?.answer ?? 'pending', state: r?.state ?? 'none', reason: r?.reason ?? null,
      };
    })
    .filter((v) => opts.id || v.startsAt.getTime() + GRACE_MS >= now.getTime())
    .sort((x, y) => (opts.id ? 0 : x.startsAt.getTime() - y.startsAt.getTime()));
}

export type RespondRemoteResult = { ok: true } | { ok: false; error: 'not_found' | 'closed' | 'invalid' | 'federationOff' };

/** Mon « je viens » / « peut-être » / « non » à une sortie d'un autre serveur : enregistré puis envoyé à l'organisateur, qui décide (places, clôture). */
export async function respondRemote(
  db: Db, userId: string, remoteOutingId: string, answer: unknown, deps: OutingFedDeps = defaultOutingDeps, now = new Date(),
): Promise<RespondRemoteResult> {
  if (answer !== 'yes' && answer !== 'maybe' && answer !== 'no') return { ok: false, error: 'invalid' };
  const v = listRemoteOutings(db, userId, { id: remoteOutingId, now })[0];
  const handle = getHandle(db, userId).handle;
  if (!v) return { ok: false, error: 'not_found' };
  if (v.closed) return { ok: false, error: 'closed' };
  if (!federationEnabled() || !handle) return { ok: false, error: 'federationOff' };
  const row = db.select({ o: remoteOuting, a: remoteActor }).from(remoteOuting).innerJoin(remoteActor, eq(remoteActor.id, remoteOuting.remoteActorId)).where(eq(remoteOuting.id, remoteOutingId)).get()!;
  const joinId = randomUUID();
  db.insert(remoteResponse).values({ remoteOutingId, userId, answer, state: 'sent', joinId, updatedAt: now })
    .onConflictDoUpdate({ target: [remoteResponse.remoteOutingId, remoteResponse.userId], set: { answer, state: 'sent', reason: null, joinId, updatedAt: now } }).run();
  await send(db, deps, handle, row.a, { t: 'join', joinId, objectUrl: row.o.objectUrl, answer });
  return { ok: true };
}

export type ReportResult = { ok: true } | { ok: false; error: 'not_found' | 'invalid' };

/**
 * Signaler une sortie d'un autre serveur (#1477) : copie pour l'admin local (une fois par compte et par sortie) puis `Flag` au serveur
 * d'origine (l'organisateur et l'objet). Le motif est facultatif, 500 caractères au plus.
 */
export async function reportRemoteOuting(
  db: Db, userId: string, remoteOutingId: string, reason: unknown, deps: OutingFedDeps = defaultOutingDeps,
): Promise<ReportResult> {
  if (reason != null && typeof reason !== 'string') return { ok: false, error: 'invalid' };
  const v = listRemoteOutings(db, userId, { id: remoteOutingId })[0];
  const row = v && db.select({ o: remoteOuting, a: remoteActor }).from(remoteOuting).innerJoin(remoteActor, eq(remoteActor.id, remoteOuting.remoteActorId)).where(eq(remoteOuting.id, remoteOutingId)).get();
  if (!v || !row) return { ok: false, error: 'not_found' };
  const text = reason?.trim().slice(0, 500) || null;
  const inserted = db.insert(federationReport).values({ reporterId: userId, objectUrl: row.o.objectUrl, domain: row.a.domain, title: row.o.title, reason: text }).onConflictDoNothing().run().changes;
  const handle = getHandle(db, userId).handle;
  if (inserted && handle) await send(db, deps, handle, row.a, { t: 'flag', objectUrl: row.o.objectUrl, reason: text });
  return { ok: true };
}

// ───────────────────────── Envoi Fedify ─────────────────────────

/** Envoi par la file Fedify (réessais ~48 h). Adressage : voir l'en-tête du fichier. */
export const deliverOutingWithFedify: OutingDeliver = async (handle, to, msg) => {
  const ctx = getFederation().createContext(new URL(publicOrigin()), undefined);
  const me = ctx.getActorUri(handle);
  const target = new URL(to.actorUrl);
  const recipient = { id: target, inboxId: new URL(to.inboxUrl), endpoints: to.sharedInboxUrl ? { sharedInbox: new URL(to.sharedInboxUrl) } : null };
  const aid = (kind: string) => new URL(`${publicOrigin()}/ap/${kind}/${randomUUID()}`);
  let activity;
  if (msg.t === 'event') {
    const addr = msg.addressing === 'public' ? { to: [PUBLIC_COLLECTION], cc: [ctx.getFollowersUri(handle)] }
      : msg.addressing === 'friends' ? { to: [new URL(friendsCollectionUrl(handle))] }
      : { to: [target] }; // sur invitation : le seul invité de cet envoi, jamais la liste des autres
    const C = msg.verb === 'Create' ? Create : Update;
    activity = new C({ id: aid(msg.verb.toLowerCase()), actor: me, object: buildEvent(msg.data, addr), tos: addr.to, ccs: addr.cc ?? [] });
  } else if (msg.t === 'delete') {
    activity = new Delete({ id: aid('delete'), actor: me, object: new Tombstone({ id: new URL(msg.objectUrl) }), tos: [target] });
  } else if (msg.t === 'flag') {
    activity = new Flag({ id: aid('flag'), actor: me, objects: [target, new URL(msg.objectUrl)], content: msg.reason, tos: [target] });
  } else if (msg.t === 'join') {
    const C = msg.answer === 'yes' ? Join : msg.answer === 'maybe' ? TentativeAccept : Leave;
    activity = new C({ id: new URL(joinUrl(msg.joinId)), actor: me, object: new URL(msg.objectUrl), tos: [target] });
  } else {
    const C = msg.accepted ? Accept : Reject;
    activity = new C({
      id: aid(msg.accepted ? 'accept' : 'reject'), actor: me, object: new Join({ id: new URL(msg.joinUrl), actor: target }),
      summary: msg.reason ?? null, tos: [target],
    });
  }
  await ctx.sendActivity({ identifier: handle }, recipient, activity);
};

export const defaultOutingDeps: OutingFedDeps = { deliver: deliverOutingWithFedify };
