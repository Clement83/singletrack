import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outing, outingPhoto, outingRide, outingVideo, type OutingRow } from '@/db/schema';
import { bboxOf, lineLength, type Position, type TrackGeometry } from '@/lib/geo';
import type { Actor } from './comments';
import { placePhoto, type Placement } from './photo-placement';

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
};

/**
 * Data of the outing recap (#1692): reference track + photos and videos (#1693) placed on it. Rights are those of the photos:
 * the caller has resolved an `Actor` (organiser, or guest with a valid link) — otherwise the route answers 404 before this.
 */
export function buildRecap(db: Db, o: OutingRow, _actor: Actor): Recap {
  void _actor;
  const ref = referenceRide(db, o);
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
  if (!ref) return { track: null, media };
  const b = bboxOf(ref.geometry)!;
  const coords = ref.geometry.type === 'LineString' ? ref.geometry.coordinates : ref.geometry.coordinates.flat();
  return {
    track: {
      id: ref.id, geometry: ref.geometry, bbox: [b.minLon, b.minLat, b.maxLon, b.maxLat],
      distanceM: ref.distanceM, gainM: ref.gainM, times: ref.times,
      profile: coords.every((p) => typeof p[2] === 'number') ? slopeProfileOf(coords) : null,
    },
    media,
  };
}

function slopeProfileOf(coords: Position[]): { km: number; ele: number }[] {
  let d = 0;
  return coords.map((p, i) => {
    if (i) d += lineLength([coords[i - 1], p]);
    return { km: Math.round(d) / 1000, ele: Math.round(p[2] as number) };
  });
}
