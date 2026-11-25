import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { outing } from '@/db/schema';
import { geometryStats, type EnrichOptions } from '@/lib/geo';
import { analyzeRide, storeRide } from './ride';
import type { TrackSnapshot } from './snapshot';

export const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SOLO_TITLE_MAX = 120;

export type SoloInput = { xml: string; clientId: string; title: string; startedAt?: string | null };
export type SoloError = 'notGpx' | 'doctype' | 'noPoints' | 'clientIdInvalid' | 'title' | 'date';
export type SoloResult = { ok: true; created: boolean; slug: string } | { ok: false; error: SoloError };

const existing = (db: Db, userId: string, clientId: string) =>
  db.select({ slug: outing.slug }).from(outing).where(and(eq(outing.createdBy, userId), eq(outing.clientId, clientId))).get();

/**
 * Solo past outing from an app recording (#1765): one person, private (`invite`), from the first to the last point of the
 * ridden GPX, which becomes the outing's reference ride. No `track` row, nobody notified (no invitation, no federation).
 * Idempotent on `(createdBy, clientId)`.
 */
export async function createSoloOutingFromRide(db: Db, userId: string, input: SoloInput, enrich: EnrichOptions = {}): Promise<SoloResult> {
  if (!CLIENT_ID_RE.test(input.clientId)) return { ok: false, error: 'clientIdInvalid' };
  const title = input.title.trim();
  if (!title || title.length > SOLO_TITLE_MAX) return { ok: false, error: 'title' };
  let fallback: Date | null = null;
  if (input.startedAt) {
    fallback = new Date(input.startedAt);
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(input.startedAt) || Number.isNaN(fallback.getTime())) return { ok: false, error: 'date' };
  }
  const prior = existing(db, userId, input.clientId);
  if (prior) return { ok: true, created: false, slug: prior.slug };

  let s;
  try {
    s = await analyzeRide(input.xml, enrich);
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    return { ok: false, error: code === 'doctype' ? 'doctype' : code === 'noTrack' ? 'noPoints' : 'notGpx' };
  }
  const first = s.times?.[0];
  const startsAt = first != null ? new Date(first) : fallback;
  if (!startsAt) return { ok: false, error: 'date' };

  const g = geometryStats(s.geometry);
  if (!g.bbox || !g.start) return { ok: false, error: 'noPoints' };
  const now = new Date();
  const snapshot: TrackSnapshot = {
    slug: '', name: title, geometry: s.geometry, bbox: [g.bbox.minLon, g.bbox.minLat, g.bbox.maxLon, g.bbox.maxLat], start: g.start,
    distanceM: s.distanceM, elevationGainM: s.gainM, elevationLossM: g.lossM, minEle: g.minEle, maxEle: g.maxEle,
    difficulty: null, loop: g.loop, source: 'gpx', license: null, attribution: null, author: null, sourceUrl: null, takenAt: now.toISOString(),
  };
  try {
    return db.transaction((tx) => {
      const o = tx.insert(outing).values({
        trackId: null, trackSnapshot: snapshot, title, startsAt,
        meetingLat: g.start![1], meetingLon: g.start![0],
        level: 'sportif', ebike: 'yes', status: 'done', visibility: 'invite',
        ownerId: userId, createdBy: userId, clientId: input.clientId,
      }).returning().get();
      const r = storeRide(tx as unknown as Db, o, { kind: 'organizer', userId }, s, now);
      tx.update(outing).set({ referenceRideId: r.id }).where(eq(outing.id, o.id)).run();
      return { ok: true as const, created: true, slug: o.slug };
    });
  } catch (e) {
    const again = existing(db, userId, input.clientId); // concurrent resend of the same recording
    if (again) return { ok: true, created: false, slug: again.slug };
    throw e;
  }
}
