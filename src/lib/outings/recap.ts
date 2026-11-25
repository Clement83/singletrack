import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outing, outingPhoto, outingRide, outingVideo, type OutingRow } from '@/db/schema';
import { bboxOf, lineLength, type Position, type TrackGeometry } from '@/lib/geo';
import type { Actor } from './comments';
import { placePhoto, type Placement } from './photo-placement';
import { isMine } from './photos';
import { isRegistered } from './ride';
import { trimEnds } from '@/lib/geo/trim-ends';

const NOT_PLACED: Placement = { method: 'none', distanceM: null, at: null, pos: null };

type RideRow = typeof outingRide.$inferSelect;

/** Ridden tracks of the outing in a stable order: the organiser's first, then by upload date. */
function allRides(db: Db, outingId: string): RideRow[] {
  return db.select().from(outingRide).where(eq(outingRide.outingId, outingId))
    .orderBy(asc(outingRide.createdAt), asc(outingRide.id)).all()
    .sort((a, b) => Number(a.invitationId !== null) - Number(b.invitationId !== null));
}

/**
 * Reference ridden track of the outing: the one the organiser chose, otherwise the organiser's own,
 * otherwise the first uploaded. `null` if nobody uploaded a track.
 */
export function referenceRide(db: Db, o: Pick<OutingRow, 'id' | 'referenceRideId'>): RideRow | null {
  const rides = allRides(db, o.id);
  return rides.find((r) => r.id === o.referenceRideId) ?? rides[0] ?? null;
}

/** The organiser picks the reference track among the outing's ridden tracks. `false` if the ride is not from this outing. */
export function setReferenceRide(db: Db, o: Pick<OutingRow, 'id'>, rideId: string): boolean {
  const r = db.select({ id: outingRide.id }).from(outingRide).where(and(eq(outingRide.id, rideId), eq(outingRide.outingId, o.id))).get();
  if (!r) return false;
  db.update(outing).set({ referenceRideId: r.id }).where(eq(outing.id, o.id)).run();
  return true;
}

/** Candidates for the organiser's selector (id, who, whether timed, whether it is the current reference). */
export type RideChoice = { id: string; author: string; organizer: boolean; timed: boolean; reference: boolean; distanceM: number };
export function listRideChoices(db: Db, o: Pick<OutingRow, 'id' | 'referenceRideId'>): RideChoice[] {
  const ref = referenceRide(db, o);
  const names = new Map(db.select({ id: invitation.id, name: invitation.name }).from(invitation).where(eq(invitation.outingId, o.id)).all().map((i) => [i.id, i.name]));
  return allRides(db, o.id).map((r) => ({
    id: r.id, author: r.invitationId ? (names.get(r.invitationId) ?? '') : '', organizer: r.invitationId === null,
    timed: !!r.times, reference: r.id === ref?.id, distanceM: r.distanceM,
  }));
}

/** A track the viewer can replay in the summary (#1773). */
export type RecapRide = { id: string; author: string; organizer: boolean; mine: boolean; distanceM: number; reference: boolean };
type ViewRide = { row: RideRow; geometry: TrackGeometry; times: number[] | null; mine: boolean };

/**
 * Tracks the actor may replay (same rights as `listRides`, #1772): registered participants see all, others only their own.
 * Other people's tracks lose their first/last 300 m, so their per-point times no longer line up: they are dropped
 * (media are then placed by position only) — the stored track is untouched.
 */
function viewableRides(db: Db, o: Pick<OutingRow, 'id'>, actor: Actor): ViewRide[] {
  const all = isRegistered(db, actor);
  const mineOf = (r: RideRow) => (actor.kind === 'guest' ? r.invitationId === actor.invitationId : r.invitationId === null && r.authorUserId === actor.userId);
  return allRides(db, o.id).flatMap((row): ViewRide[] => {
    const mine = mineOf(row);
    if (!mine && !all) return [];
    if (mine) return [{ row, geometry: row.geometry, times: row.times, mine }];
    const geometry = row.remoteUrl ? row.geometry : trimEnds(row.geometry); // already trimmed by its server (#1775)
    return geometry ? [{ row, geometry, times: null, mine }] : [];
  });
}

/**
 * Track replayed by default and for a given `?ride=` (#1773): the requested one if the viewer may see it, otherwise
 * their own, otherwise the outing's reference (when visible), otherwise the first visible one.
 */
export function pickRide(db: Db, o: Pick<OutingRow, 'id' | 'referenceRideId'>, actor: Actor, rideId?: string | null): ViewRide | null {
  const rides = viewableRides(db, o, actor);
  const ref = referenceRide(db, o);
  return (rideId ? rides.find((r) => r.row.id === rideId) : undefined) ?? rides.find((r) => r.mine) ?? rides.find((r) => r.row.id === ref?.id) ?? rides[0] ?? null;
}

export type RecapMedia = {
  id: string;
  type: 'photo' | 'video';
  author: string;
  organizer: boolean;
  width: number;
  height: number;
  /** Capture time (epoch ms) if known. */
  takenAt: number | null;
  /** Clip length for a video (#1693), `null` for a photo. */
  durationMs: number | null;
  placement: Placement;
  /** The viewer may delete it from the player (#1701): its author, or the organiser — same rule as the gallery. */
  canDelete: boolean;
};
export type Recap = {
  /** `null` when nobody uploaded a ridden track. */
  track: {
    id: string;
    geometry: TrackGeometry;
    bbox: [number, number, number, number];
    distanceM: number;
    gainM: number | null;
    /** Epoch ms of each point of `geometry` (flattened); `null` for an old/untimed track. */
    times: number[] | null;
    profile: { km: number; ele: number }[] | null;
  } | null;
  /** Photos and ready videos ordered along the track (placed ones by distance, then the unplaced by capture / upload order). */
  media: RecapMedia[];
  /** Tracks the viewer can switch to (#1773), mine first then the organiser's, `reference` = the organiser's choice. */
  choices: RecapRide[];
};

/**
 * Data of the outing recap (#1692): reference track + photos and videos (#1693) placed on it. Rights are those of the photos:
 * the caller has resolved an `Actor` (organiser, or guest with a valid link) — otherwise the route answers 404 before this.
 */
export function buildRecap(db: Db, o: OutingRow, actor: Actor, rideId?: string | null): Recap {
  const picked = pickRide(db, o, actor, rideId);
  const ref = picked ? { id: picked.row.id, geometry: picked.geometry, times: picked.times, distanceM: picked.row.distanceM, gainM: picked.row.gainM } : null;
  const refId = referenceRide(db, o)?.id;
  const names = new Map(db.select({ id: invitation.id, name: invitation.name }).from(invitation).where(eq(invitation.outingId, o.id)).all().map((i) => [i.id, i.name]));
  const choices: RecapRide[] = viewableRides(db, o, actor).map((r) => ({
    id: r.row.id, author: r.row.invitationId ? (names.get(r.row.invitationId) ?? '') : '', organizer: r.row.invitationId === null,
    mine: r.mine, distanceM: r.row.distanceM, reference: r.row.id === refId,
  })).sort((a, b) => Number(b.mine) - Number(a.mine));
  const photos = db.select({ p: outingPhoto, name: invitation.name }).from(outingPhoto)
    .leftJoin(invitation, eq(invitation.id, outingPhoto.invitationId))
    .where(eq(outingPhoto.outingId, o.id)).orderBy(asc(outingPhoto.createdAt), asc(outingPhoto.id)).all()
    .map(({ p, name }) => ({ p, name, type: 'photo' as const, durationMs: null }));
  // Short videos (#1693): only converted ones, placed like photos.
  const videos = db.select({ p: outingVideo, name: invitation.name }).from(outingVideo)
    .leftJoin(invitation, eq(invitation.id, outingVideo.invitationId))
    .where(and(eq(outingVideo.outingId, o.id), eq(outingVideo.status, 'ready'))).orderBy(asc(outingVideo.createdAt), asc(outingVideo.id)).all()
    .map(({ p, name }) => ({ p, name, type: 'video' as const, durationMs: p.durationMs }));
  const rows = [...photos, ...videos].sort((a, b) => a.p.createdAt.getTime() - b.p.createdAt.getTime());
  const media: RecapMedia[] = rows.map(({ p, name, type, durationMs }, idx) => ({
    id: p.id, type, author: name ?? '', organizer: p.invitationId === null,
    width: p.width, height: p.height, takenAt: p.takenAt, durationMs,
    canDelete: actor.kind === 'organizer' || isMine(p, actor),
    placement: ref ? placePhoto({ geometry: ref.geometry, times: ref.times }, { takenAt: p.takenAt, lat: p.lat, lon: p.lon }) : NOT_PLACED,
    _i: idx,
  })).sort((a, b) => {
    const da = a.placement.distanceM;
    const dbm = b.placement.distanceM;
    if (da != null && dbm != null) return da - dbm || a._i - b._i;
    if (da != null) return -1;
    if (dbm != null) return 1;
    return (a.takenAt ?? Infinity) - (b.takenAt ?? Infinity) || a._i - b._i;
  }).map(({ _i, ...m }) => { void _i; return m; });
  if (!ref) return { track: null, media, choices };
  const b = bboxOf(ref.geometry)!;
  const coords = ref.geometry.type === 'LineString' ? ref.geometry.coordinates : ref.geometry.coordinates.flat();
  return {
    track: {
      id: ref.id, geometry: ref.geometry, bbox: [b.minLon, b.minLat, b.maxLon, b.maxLat],
      distanceM: ref.distanceM, gainM: ref.gainM, times: ref.times,
      profile: coords.every((p) => typeof p[2] === 'number') ? slopeProfileOf(coords) : null,
    },
    media,
    choices,
  };
}

function slopeProfileOf(coords: Position[]): { km: number; ele: number }[] {
  let d = 0;
  return coords.map((p, i) => {
    if (i) d += lineLength([coords[i - 1], p]);
    return { km: Math.round(d) / 1000, ele: Math.round(p[2] as number) };
  });
}
