import { and, between, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outing, user, type OutingRow } from '@/db/schema';
import { outingPermissions } from './permissions';
import { archiveOverrides } from './leave';
import { decryptToken } from './tokens';
import type { TrackGeometry } from '@/lib/geo/types';
import { bboxOf, lines, simplifyGeometry } from '@/lib/geo';
import { profileFor } from './profile';
import type { TrackSnapshot } from './snapshot';
import { utcToParisInputs } from './time';
import { countYes, isClosed } from './service';
import { listParticipants, type Participant } from './participants';

/**
 * "Upcoming outings" on the map (#1461, epic #1463 P7). An outing shows at its **meeting point** if the account can see it
 * (`outingPermissions.canView`: public, owner, guest linked to an account even without an answer, or friend of the owner
 * of a "friends" outing), if it is planned, upcoming and not hidden (archived) by this account.
 * Lean summary: never an organiser slug, token, email or participants' first names.
 */
export type MapOuting = {
  id: string;
  title: string;
  startsAt: Date;
  lat: number;
  lon: number;
  meetingLabel: string | null;
  distanceM: number;
  gainM: number | null;
  level: OutingRow['level'];
  ebike: OutingRow['ebike'];
  visibility: OutingRow['visibility'];
  organizerName: string;
  yesCount: number;
  spotsLeft: number | null;
  /** The account is owner, creator or linked guest: the card links to their page. */
  mine: boolean;
};

export type MapBbox = [number, number, number, number];
export const MAP_OUTINGS_MAX = 200;

export function listMapOutings(db: Db, viewerId: string | null, bbox: MapBbox, now = new Date()): MapOuting[] {
  const today = utcToParisInputs(now).date;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const rows = db.select({ o: outing, organizer: user.name }).from(outing)
    .innerJoin(user, eq(user.id, outing.createdBy))
    .where(and(eq(outing.status, 'planned'), between(outing.meetingLat, minLat, maxLat), between(outing.meetingLon, minLon, maxLon)))
    .all()
    .filter(({ o }) => utcToParisInputs(o.startsAt).date >= today)
    .sort((a, b) => a.o.startsAt.getTime() - b.o.startsAt.getTime());
  if (!rows.length) return [];

  const hidden = viewerId ? archiveOverrides(db, viewerId) : new Map<string, boolean>();
  const mineInv = new Set(viewerId ? db.select({ outingId: invitation.outingId }).from(invitation)
    .where(and(eq(invitation.userId, viewerId), isNull(invitation.revokedAt))).all().map((i) => i.outingId) : []);

  const out: MapOuting[] = [];
  for (const { o, organizer } of rows) {
    if (out.length >= MAP_OUTINGS_MAX) break;
    if (hidden.get(o.id) === true) continue;
    // Anonymous (#1589): public outings only (never friends or invitation only).
    if (!viewerId ? o.visibility !== 'public' : !outingPermissions(db, { userId: viewerId }, o, now).canView) continue;
    const yesCount = countYes(db, o.id);
    out.push({
      id: o.id, title: o.title, startsAt: o.startsAt, lat: o.meetingLat, lon: o.meetingLon, meetingLabel: o.meetingLabel,
      distanceM: o.trackSnapshot.distanceM, gainM: o.trackSnapshot.elevationGainM ?? null,
      level: o.level, ebike: o.ebike, visibility: o.visibility, organizerName: organizer, yesCount,
      spotsLeft: o.maxParticipants == null ? null : Math.max(0, o.maxParticipants - yesCount),
      mine: !!viewerId && (o.ownerId === viewerId || o.createdBy === viewerId || mineInv.has(o.id)),
    });
  }
  return out;
}

export type OutingDiscovery =
  | { kind: 'redirect'; path: string }
  | { kind: 'show'; outing: MapOuting & { description: string | null; geometry: TrackGeometry; track: Pick<TrackSnapshot, 'name' | 'geometry' | 'bbox' | 'start' | 'distanceM' | 'elevationGainM' | 'attribution' | 'license'> }; canJoin: boolean; full: boolean }
  | { kind: 'notFound' };

/**
 * Discovery page (#1461) of an outing designated by its **id** (the organiser slug is never exposed).
 * Unknown or not visible ⇒ `notFound` (same answer). Already attached (owner, creator, linked guest) ⇒ redirect to
 * their page: `/s/<slug>`, or decrypted `/i/<token>` (#1456); if the link is unavailable (created before encryption),
 * the page is shown without the "I'm in" button.
 */
export function getOutingDiscovery(db: Db, viewerId: string, outingId: string, now = new Date()): OutingDiscovery {
  const row = db.select({ o: outing, organizer: user.name }).from(outing)
    .innerJoin(user, eq(user.id, outing.createdBy)).where(eq(outing.id, outingId)).get();
  if (!row) return { kind: 'notFound' };
  const { o, organizer } = row;
  const perms = outingPermissions(db, { userId: viewerId }, o, now);
  if (!perms.canView) return { kind: 'notFound' };
  if (perms.isOwner || o.createdBy === viewerId) return { kind: 'redirect', path: `/s/${o.slug}` };
  const inv = db.select().from(invitation)
    .where(and(eq(invitation.outingId, o.id), eq(invitation.userId, viewerId), isNull(invitation.revokedAt))).get();
  let linkUnavailable = false;
  if (inv) {
    const token = decryptToken(inv.tokenEnc);
    if (token) return { kind: 'redirect', path: `/i/${token}` };
    linkUnavailable = true;
  }
  const yesCount = countYes(db, o.id);
  const full = o.maxParticipants != null && yesCount >= o.maxParticipants;
  return {
    kind: 'show',
    outing: {
      id: o.id, title: o.title, description: o.description, geometry: o.trackSnapshot.geometry,
      // Never the slug of the original track (#1592): fields picked one by one.
      track: (({ name, geometry, bbox, start, distanceM, elevationGainM, attribution, license }) => ({ name, geometry, bbox, start, distanceM, elevationGainM, attribution, license }))(o.trackSnapshot),
      startsAt: o.startsAt, lat: o.meetingLat, lon: o.meetingLon, meetingLabel: o.meetingLabel,
      distanceM: o.trackSnapshot.distanceM, gainM: o.trackSnapshot.elevationGainM ?? null,
      level: o.level, ebike: o.ebike, visibility: o.visibility, organizerName: organizer, yesCount,
      spotsLeft: o.maxParticipants == null ? null : Math.max(0, o.maxParticipants - yesCount), mine: !!inv,
    },
    canJoin: perms.canJoin && !full && !isClosed(o, now) && !linkUnavailable && !inv,
    full,
  };
}

/** Frozen route of an outing for the map (#1596): geometry + profile only, never the slug or id of the original track. */
export type MapOutingTrack = {
  geometry: TrackGeometry;
  profile: ReturnType<typeof profileFor>;
  bbox: [number, number, number, number];
  end: [number, number];
  /** Content of the `OutingView` panel (#1599): never the slug or id of the original track. */
  description: string | null;
  track: Pick<TrackSnapshot, 'name' | 'distanceM' | 'elevationGainM' | 'attribution' | 'license'>;
  /** First names only for someone attached to the outing (owner, creator, linked guest); otherwise `null` (the list's counter is enough). */
  participants: Participant[] | null;
};

/**
 * Route (`trackSnapshot`) of an outing visible on the map, loaded on demand. Same rights as `listMapOutings`:
 * anonymous = `public` outing only, signed in = `canView`; unknown, past/cancelled or not visible ⇒ `null` (404, never 403).
 */
export function getMapOutingTrack(db: Db, viewerId: string | null, outingId: string, now = new Date()): MapOutingTrack | null {
  const o = db.select().from(outing).where(eq(outing.id, outingId)).get();
  if (!o || o.status !== 'planned') return null;
  const ok = viewerId ? outingPermissions(db, { userId: viewerId }, o, now).canView : o.visibility === 'public';
  if (!ok) return null;
  const full = o.trackSnapshot.geometry;
  const ls = lines(full);
  const last = ls[ls.length - 1]?.at(-1);
  const bbox = bboxOf(full);
  if (!last || !bbox) return null;
  const t = o.trackSnapshot;
  const attached = !!viewerId && (o.ownerId === viewerId || o.createdBy === viewerId || !!db.select({ id: invitation.id }).from(invitation)
    .where(and(eq(invitation.outingId, o.id), eq(invitation.userId, viewerId), isNull(invitation.revokedAt))).get());
  return {
    geometry: simplifyGeometry(full, 5), profile: profileFor(full), bbox: [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat], end: [last[0], last[1]],
    description: o.description,
    track: { name: t.name, distanceM: t.distanceM, elevationGainM: t.elevationGainM ?? null, attribution: t.attribution, license: t.license },
    participants: attached ? listParticipants(db, o.id, { userId: viewerId }) : null,
  };
}
