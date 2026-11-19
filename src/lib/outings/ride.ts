import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outingRide, type OutingRow } from '@/db/schema';
import { bboxOf, enrichElevation, type EnrichOptions, gainLoss, haversine, lineLength, parseGpxFile, simplifyGeometry, type Position, type TrackGeometry } from '@/lib/geo';
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
};

/** Points of a GPX with their timestamp (`<time>`), per segment. */
function timedSegments(xml: string): { p: Position; t: number | null }[][] {
  const segs: { p: Position; t: number | null }[][] = [];
  const segRe = /<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/g;
  let m: RegExpExecArray | null;
  while ((m = segRe.exec(xml))) {
    const seg: { p: Position; t: number | null }[] = [];
    const ptRe = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
    let q: RegExpExecArray | null;
    while ((q = ptRe.exec(m[1]))) {
      const lat = /\blat\s*=\s*["']([^"']+)["']/.exec(q[1])?.[1];
      const lon = /\blon\s*=\s*["']([^"']+)["']/.exec(q[1])?.[1];
      if (lat === undefined || lon === undefined || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon))) continue;
      const ele = q[2] ? /<ele>\s*([^<\s]+)\s*<\/ele>/.exec(q[2])?.[1] : undefined;
      const time = q[2] ? /<time>\s*([^<\s]+)\s*<\/time>/.exec(q[2])?.[1] : undefined;
      const ms = time ? Date.parse(time) : NaN;
      seg.push({
        p: ele !== undefined && !Number.isNaN(Number(ele)) ? [Number(lon), Number(lat), Number(ele)] : [Number(lon), Number(lat)],
        t: Number.isNaN(ms) ? null : ms / 1000,
      });
    }
    if (seg.length) segs.push(seg);
  }
  return segs;
}

/**
 * Analyses a ridden GPX: distance, elevation gain (elevations smoothed as everywhere), moving time
 * (stops and GPS pauses do not count) and total duration. Throws `notGpx`, `doctype`, `noTrack`.
 */
export async function analyzeRide(xml: string, enrich: EnrichOptions = {}): Promise<RideStats> {
  const file = parseGpxFile(xml); // valid (rejects DOCTYPE/ENTITY, no track); the geometry comes from here if there is no <trkseg> (rte)
  const segs = timedSegments(xml).filter((s) => s.length >= 2);
  const lines: Position[][] = segs.length ? segs.map((s) => s.map((x) => x.p)) : file.tracks.flatMap((t) => (t.geometry.type === 'LineString' ? [t.geometry.coordinates] : t.geometry.coordinates));
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
      const dt = t - prev;
      if (dt <= 0 || dt > MAX_GAP_S) continue;
      if (haversine(s[i - 1].p, s[i].p) / dt >= STOP_SPEED_MS) moving += dt;
    }
  }
  return {
    geometry: simplifyGeometry(raw, 5),
    distanceM: Math.round(distanceM),
    gainM: gainM == null ? null : Math.round(gainM),
    movingSec: timed ? Math.round(moving) : null,
    elapsedSec: timed && first != null && last != null ? Math.round(last - first) : null,
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
  const values = { geometry: s.geometry, distanceM: s.distanceM, gainM: s.gainM, movingSec: s.movingSec, elapsedSec: s.elapsedSec };
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

/** Tracks visible to the actor: the guest only sees their own, the organiser sees everyone's. */
export function listRides(db: Db, outingId: string, actor: Actor): RideView[] {
  const rows = db.select({ r: outingRide, name: invitation.name }).from(outingRide)
    .leftJoin(invitation, eq(invitation.id, outingRide.invitationId))
    .where(eq(outingRide.outingId, outingId)).all();
  return rows
    .filter(({ r }) => actor.kind === 'organizer' || r.invitationId === actor.invitationId)
    .sort((a, b) => Number(a.r.invitationId !== null) - Number(b.r.invitationId !== null) || a.r.createdAt.getTime() - b.r.createdAt.getTime())
    .map(({ r, name }) => {
      const b = bboxOf(r.geometry)!;
      return {
        id: r.id, author: name ?? '', organizer: r.invitationId === null,
        mine: actor.kind === 'guest' ? r.invitationId === actor.invitationId : r.invitationId === null && r.authorUserId === actor.userId,
        geometry: r.geometry, bbox: [b.minLon, b.minLat, b.maxLon, b.maxLat] as [number, number, number, number],
        distanceM: r.distanceM, gainM: r.gainM, movingSec: r.movingSec, elapsedSec: r.elapsedSec,
      };
    });
}
