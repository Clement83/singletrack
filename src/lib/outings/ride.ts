import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outingRide, type OutingRow } from '@/db/schema';
import { trimEnds, bboxOf, dedupeLineIndexes, enrichElevation, type EnrichOptions, gainLoss, gpxTimedSegments, haversine, kmlTimedSegments, lineLength, parseGpxFile, parseKmlFile, simplifyIndexes, type Position, type TrackGeometry } from '@/lib/geo';
import { type Actor } from './comments';

export const RIDE_MAX_BYTES = 5 * 1024 * 1024;
/** Below this speed we are stopped; beyond this pause the GPS was paused (not moving time). */
const STOP_SPEED_MS = 0.5;
const MAX_GAP_S = 300;

export type RideStats = {
  geometry: TrackGeometry;
  distanceM: number;
  gainM: number | null;
  movingSec: number | null;
  elapsedSec: number | null;
  /** Epoch ms of each point of `geometry` (flattened); `null` without timestamps (#1692). */
  times: number[] | null;
};

/** Fills the holes of a per-point time list (linear between known neighbours, flat at the ends); `null` if fewer than 2 known times. */
export function fillTimes(ts: (number | null)[]): number[] | null {
  const known = ts.flatMap((t, i) => (t == null ? [] : [i]));
  if (known.length < 2) return null;
  return ts.map((t, i) => {
    if (t != null) return t;
    const next = known.find((k) => k > i);
    const prev = [...known].reverse().find((k) => k < i);
    if (prev === undefined) return ts[next!]!;
    if (next === undefined) return ts[prev]!;
    return ts[prev]! + ((ts[next]! - ts[prev]!) * (i - prev)) / (next - prev);
  });
}

const isKml = (xml: string) => /<kml\b/.test(xml) && !/<gpx\b/.test(xml);

/**
 * Analyses a ridden GPX or KML (#1692): distance, elevation gain (elevations smoothed as everywhere), moving time
 * (stops and GPS pauses do not count) and total duration. Throws `notGpx`, `doctype`, `noTrack`.
 */
export async function analyzeRide(xml: string, enrich: EnrichOptions = {}): Promise<RideStats> {
  const kml = isKml(xml);
  const file = kml ? parseKmlFile(xml) : parseGpxFile(xml); // valid (rejects DOCTYPE/ENTITY, no track); the geometry comes from here if there is no <trkseg> (rte)
  const allSegs = (kml ? kmlTimedSegments(xml) : gpxTimedSegments(xml)).filter((s) => s.length >= 2);
  // #1699: the same ride written twice in the file (gx:Track + LineString, two identical <trk>) is counted once.
  const keep = dedupeLineIndexes(allSegs.map((s) => s.map((x) => x.p)), allSegs.map((s) => s.some((x) => x.t != null)));
  const segs = keep.map((i) => allSegs[i]);
  const fileLines: Position[][] = file.tracks.flatMap((t) => (t.geometry.type === 'LineString' ? [t.geometry.coordinates] : t.geometry.coordinates));
  const lines: Position[][] = segs.length ? segs.map((s) => s.map((x) => x.p)) : dedupeLineIndexes(fileLines).map((i) => fileLines[i]);
  if (lines.length === 0) throw new Error('noTrack');
  const rawGeom: TrackGeometry = lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
  // IGN elevation (#1515); GPS as a fallback if IGN is unavailable. Times stay those of the file (points unchanged in number/order).
  let raw = rawGeom;
  try {
    raw = await enrichElevation(rawGeom, { replace: true, ...enrich });
  } catch {
    raw = rawGeom;
  }
  const eleLines: Position[][] = raw.type === 'LineString' ? [raw.coordinates] : raw.coordinates;
  const distanceM = lines.reduce((a, l) => a + lineLength(l), 0);
  const withEle = eleLines.every((l) => l.every((p) => typeof p[2] === 'number'));
  const gainM = withEle ? eleLines.reduce((a, l) => a + gainLoss(l.map((p) => p[2] as number)).gainM, 0) : null;

  let moving = 0;
  let first: number | null = null;
  let last: number | null = null;
  let timed = false;
  for (const s of segs) {
    for (let i = 0; i < s.length; i++) {
      const t = s[i].t;
      if (t == null) continue;
      timed = true;
      first = first == null ? t : Math.min(first, t);
      last = last == null ? t : Math.max(last, t);
      const prev = s[i - 1]?.t;
      if (prev == null) continue;
      const dt = (t - prev) / 1000;
      if (dt <= 0 || dt > MAX_GAP_S) continue;
      if (haversine(s[i - 1].p, s[i].p) / dt >= STOP_SPEED_MS) moving += dt;
    }
  }
  // Simplify to 5 m, carrying each kept point's time along (segments and lines are index-aligned).
  const kept = eleLines.map((l) => simplifyIndexes(l, 5));
  const simpLines = eleLines.map((l, k) => kept[k].map((i) => l[i]));
  const times = timed && segs.length === eleLines.length ? fillTimes(segs.flatMap((sg, k) => kept[k].map((i) => sg[i].t))) : null;
  return {
    geometry: simpLines.length === 1 ? { type: 'LineString', coordinates: simpLines[0] } : { type: 'MultiLineString', coordinates: simpLines },
    times,
    distanceM: Math.round(distanceM),
    gainM: gainM == null ? null : Math.round(gainM),
    movingSec: timed ? Math.round(moving) : null,
    elapsedSec: timed && first != null && last != null ? Math.round((last - first) / 1000) : null,
  };
}

export type RideView = {
  id: string;
  /** Guest's first name; `organizer` for the organiser. */
  author: string;
  organizer: boolean;
  mine: boolean;
  geometry: TrackGeometry;
  bbox: [number, number, number, number];
  distanceM: number;
  gainM: number | null;
  movingSec: number | null;
  elapsedSec: number | null;
};

export type RideResult<T = object> = ({ ok: true } & T) | { ok: false; error: 'not_found' | 'closed' | 'tooLarge' | 'notGpx' | 'doctype' | 'noTrack' | 'tooEarly' };

const where = (outingId: string, a: Actor) =>
  a.kind === 'guest'
    ? and(eq(outingRide.outingId, outingId), eq(outingRide.invitationId, a.invitationId))
    : and(eq(outingRide.outingId, outingId), isNull(outingRide.invitationId), eq(outingRide.authorUserId, a.userId));

/** A ridden track only makes sense once the outing has started, and not for a cancelled outing. */
export function canUploadRide(o: Pick<OutingRow, 'status' | 'startsAt'>, now = new Date()): boolean {
  return o.status !== 'cancelled' && o.startsAt.getTime() <= now.getTime() + 3 * 3600_000;
}

/** Stores (or replaces) the actor's track. */
export async function saveRide(db: Db, o: OutingRow, actor: Actor, xml: string, now = new Date(), enrich: EnrichOptions = {}): Promise<RideResult<{ id: string }>> {
  if (xml.length > RIDE_MAX_BYTES) return { ok: false, error: 'tooLarge' };
  if (o.status === 'cancelled') return { ok: false, error: 'closed' };
  if (!canUploadRide(o, now)) return { ok: false, error: 'tooEarly' };
  let s: RideStats;
  try {
    s = await analyzeRide(xml, enrich);
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    return { ok: false, error: code === 'doctype' || code === 'noTrack' ? code : 'notGpx' };
  }
  return storeRide(db, o, actor, s, now);
}

/** Inserts or replaces the actor's ride from already analysed stats (#1765: shared with the app's solo outing creation). */
export function storeRide(db: Db, o: OutingRow, actor: Actor, s: RideStats, now = new Date()): { ok: true; id: string } {
  const values = { geometry: s.geometry, distanceM: s.distanceM, gainM: s.gainM, movingSec: s.movingSec, elapsedSec: s.elapsedSec, times: s.times };
  return db.transaction((tx) => {
    const existing = tx.select().from(outingRide).where(where(o.id, actor)).get();
    if (existing) {
      tx.update(outingRide).set({ ...values, createdAt: now }).where(eq(outingRide.id, existing.id)).run();
      return { ok: true as const, id: existing.id };
    }
    const row = tx.insert(outingRide).values({
      outingId: o.id, ...values,
      invitationId: actor.kind === 'guest' ? actor.invitationId : null,
      authorUserId: actor.kind === 'organizer' ? actor.userId : null,
    }).returning({ id: outingRide.id }).get();
    return { ok: true as const, id: row.id };
  });
}

export function deleteRide(db: Db, o: OutingRow, actor: Actor): void {
  db.delete(outingRide).where(where(o.id, actor)).run();
}

/** Registered participant (#1772): the organiser, or a guest whose invitation is live and answered "yes" or "maybe". */
export function isRegistered(db: Db, actor: Actor): boolean {
  if (actor.kind === 'organizer') return true;
  const inv = db.select({ status: invitation.status, revokedAt: invitation.revokedAt }).from(invitation).where(eq(invitation.id, actor.invitationId)).get();
  return !!inv && !inv.revokedAt && (inv.status === 'yes' || inv.status === 'maybe');
}

/**
 * Tracks visible to the actor (#1772): every registered participant sees everyone's (the organiser too); anyone else (pending
 * or declined guest) only their own. Other people's tracks lose their first and last 300 m (`trimEnds`, applied here on read:
 * the stored track stays whole); a track too short to keep anything is left out. Stats stay those of the whole ride.
 */
export function listRides(db: Db, outingId: string, actor: Actor): RideView[] {
  const rows = db.select({ r: outingRide, name: invitation.name }).from(outingRide)
    .leftJoin(invitation, eq(invitation.id, outingRide.invitationId))
    .where(eq(outingRide.outingId, outingId)).all();
  const isMine = (r: typeof outingRide.$inferSelect) => (actor.kind === 'guest' ? r.invitationId === actor.invitationId : r.invitationId === null && r.authorUserId === actor.userId);
  const all = isRegistered(db, actor);
  return rows
    .filter(({ r }) => all || isMine(r))
    .sort((a, b) => Number(a.r.invitationId !== null) - Number(b.r.invitationId !== null) || a.r.createdAt.getTime() - b.r.createdAt.getTime())
    .flatMap(({ r, name }) => {
      const mine = isMine(r);
      const geometry = mine ? r.geometry : trimEnds(r.geometry);
      if (!geometry) return [];
      const b = bboxOf(geometry)!;
      return [{
        id: r.id, author: name ?? '', organizer: r.invitationId === null, mine,
        geometry, bbox: [b.minLon, b.minLat, b.maxLon, b.maxLat] as [number, number, number, number],
        distanceM: r.distanceM, gainM: r.gainM, movingSec: r.movingSec, elapsedSec: r.elapsedSec,
      }];
    });
}
