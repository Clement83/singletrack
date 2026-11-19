import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { contact, invitation, outing, user, OUTING_VISIBILITIES, TRACK_VISIBILITIES } from '@/db/schema';
import { CHARTES } from '@/lib/design/themes';
import { areFriends } from '@/lib/friends';
import { isDone, listClaimedHistory, listHistory } from '@/lib/outings/history';
import { outingPermissions, type OutingFacts } from '@/lib/outings/permissions';

/**
 * Profile and stats (#1433). Visibility `private` (default: oneself and one's friends) or `public` (any signed-in account).
 * Stats reuse `listHistory` (#1411): no duplicated computation. Never an email or participants exposed.
 */
export const VISIBILITIES = ['private', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const isVisibility = (v: unknown): v is Visibility => VISIBILITIES.includes(v as Visibility);

export function getVisibility(db: Db, userId: string): Visibility {
  const v = db.select({ v: user.profileVisibility }).from(user).where(eq(user.id, userId)).get()?.v;
  return isVisibility(v) ? v : 'private';
}

export function setVisibility(db: Db, userId: string, value: unknown): { ok: true } | { ok: false; error: string } {
  if (!isVisibility(value)) return { ok: false, error: 'invalid' };
  db.update(user).set({ profileVisibility: value, updatedAt: new Date() }).where(eq(user.id, userId)).run();
  return { ok: true };
}

/**
 * Outing visibility (#1442): `public` (any signed-in account), `friends` (accepted friends), `invite` (link guests only).
 * The account default pre-fills each new outing, which may override it.
 */
export { OUTING_VISIBILITIES };
export type OutingVisibility = (typeof OUTING_VISIBILITIES)[number];
export const isOutingVisibility = (v: unknown): v is OutingVisibility => OUTING_VISIBILITIES.includes(v as OutingVisibility);

export function getDefaultOutingVisibility(db: Db, userId: string): OutingVisibility {
  const v = db.select({ v: user.defaultOutingVisibility }).from(user).where(eq(user.id, userId)).get()?.v;
  return isOutingVisibility(v) ? v : 'friends';
}

export function setDefaultOutingVisibility(db: Db, userId: string, value: unknown): { ok: true } | { ok: false; error: string } {
  // "Public" freezes the outing (no owner): never an account default (#1455).
  if (!isOutingVisibility(value) || value === 'public') return { ok: false, error: 'invalid' };
  db.update(user).set({ defaultOutingVisibility: value, updatedAt: new Date() }).where(eq(user.id, userId)).run();
  return { ok: true };
}

/**
 * Default track visibility (#1588): `public` | `friends` | `private`, one preference for drawn
 * tracks (default `public`) and one for imported tracks (default `private`).
 */
export { TRACK_VISIBILITIES };
export type TrackVisibility = (typeof TRACK_VISIBILITIES)[number];
export const isTrackVisibility = (v: unknown): v is TrackVisibility => TRACK_VISIBILITIES.includes(v as TrackVisibility);
export type TrackOrigin = 'drawn' | 'imported';

export function getDefaultTrackVisibility(db: Db, userId: string, origin: TrackOrigin): TrackVisibility {
  const row = db.select({ d: user.defaultDrawnTrackVisibility, i: user.defaultImportedTrackVisibility }).from(user).where(eq(user.id, userId)).get();
  const v = origin === 'drawn' ? row?.d : row?.i;
  return isTrackVisibility(v) ? v : origin === 'drawn' ? 'public' : 'private';
}

export function setDefaultTrackVisibility(db: Db, userId: string, origin: TrackOrigin, value: unknown): { ok: true } | { ok: false; error: string } {
  if (!isTrackVisibility(value)) return { ok: false, error: 'invalid' };
  db.update(user).set({ ...(origin === 'drawn' ? { defaultDrawnTrackVisibility: value } : { defaultImportedTrackVisibility: value }), updatedAt: new Date() }).where(eq(user.id, userId)).run();
  return { ok: true };
}

/** Visual charter of the account (#1625): id declared in design/tokens.json; unknown ⇒ `classique`. */
export const isCharte = (v: unknown): v is string => CHARTES.some((c) => c.id === v);

export function getCharte(db: Db, userId: string): string {
  const v = db.select({ v: user.charte }).from(user).where(eq(user.id, userId)).get()?.v;
  return isCharte(v) ? v : CHARTES[0].id;
}

export function setCharte(db: Db, userId: string, value: unknown): { ok: true } | { ok: false; error: string } {
  if (!isCharte(value)) return { ok: false, error: 'charteInvalid' };
  db.update(user).set({ charte: value, updatedAt: new Date() }).where(eq(user.id, userId)).run();
  return { ok: true };
}

/** Can a signed-in account see this outing? Delegates to `outingPermissions` (#1455), single source of rights. */
export function canSeeOuting(db: Db, viewerId: string, o: OutingFacts): boolean {
  return outingPermissions(db, { userId: viewerId }, o).canView;
}

export type ProfileRide = { slug?: string; title: string; startsAt: Date; distanceM: number; withViewer?: boolean };
export type Profile = {
  id: string;
  name: string;
  isSelf: boolean;
  isFriend: boolean;
  visibility: Visibility;
  totals: { outings: number; distanceM: number; gainM: number; lastAt: Date | null };
  /** Completed outings of the profile (title, date, distance), without a link: the organiser page stays private. */
  rides: ProfileRide[];
  /** The visitor's outings (so openable by them) that this profile answered "I'm in" to through their buddy book. */
  shared: ProfileRide[];
};

/** Profile visible to `viewerId`, or `null` (⇒ 404, without telling "unknown" from "private"). */
export function getProfile(db: Db, viewerId: string, profileId: string, now = new Date()): Profile | null {
  const u = db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, profileId)).get();
  if (!u || !u.name) return null;
  const isSelf = viewerId === profileId;
  const isFriend = !isSelf && areFriends(db, viewerId, profileId);
  const visibility = getVisibility(db, profileId);
  if (!isSelf && !isFriend && visibility !== 'public') return null;

  const history = listHistory(db, profileId, now);
  // Outings joined through a link attached to the account (#1434): counted in the stats, without a link (organiser page private).
  const claimed = listClaimedHistory(db, profileId, now);
  const entries = [...history.entries, ...claimed].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const totals = {
    outings: entries.length,
    distanceM: entries.reduce((n, e) => n + e.distanceM, 0),
    gainM: entries.reduce((n, e) => n + e.gainM, 0),
  };
  const withViewer = new Set(
    isSelf ? [] : db.select({ outingId: invitation.outingId }).from(invitation)
      .innerJoin(contact, eq(contact.id, invitation.contactId))
      .where(and(eq(contact.ownerUserId, profileId), eq(contact.userId, viewerId), eq(invitation.status, 'yes'), isNull(invitation.revokedAt)))
      .all().map((r) => r.outingId),
  );
  const own = db.select({ id: outing.id, slug: outing.slug }).from(outing).where(eq(outing.createdBy, profileId)).all();
  const slugToId = new Map(own.map((o) => [o.slug, o.id]));

  const shared: ProfileRide[] = isSelf ? [] : db.select({ o: outing }).from(invitation)
    .innerJoin(outing, eq(outing.id, invitation.outingId))
    .innerJoin(contact, eq(contact.id, invitation.contactId))
    .where(and(eq(outing.createdBy, viewerId), eq(contact.ownerUserId, viewerId), eq(contact.userId, profileId), eq(invitation.status, 'yes'), isNull(invitation.revokedAt)))
    .all().map((r) => r.o).filter((o) => isDone(o, now))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
    .map((o) => ({ slug: o.slug, title: o.title, startsAt: o.startsAt, distanceM: o.trackSnapshot.distanceM }));

  return {
    id: u.id, name: u.name, isSelf, isFriend, visibility,
    totals: { ...totals, lastAt: entries[0]?.startsAt ?? null },
    rides: entries.map((e) => ({ title: e.title, startsAt: e.startsAt, distanceM: e.distanceM, withViewer: withViewer.has(slugToId.get(e.slug) ?? '') })),
    shared,
  };
}
