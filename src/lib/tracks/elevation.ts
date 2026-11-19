import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { track, type TrackRow } from '@/db/schema';
import { enrichElevation, geometryStats, type EnrichOptions } from '@/lib/geo';

/**
 * Elevation on demand (#1428): tracks imported in bulk (OSM…) have no elevation, IGN is not
 * queried at import (thousands of tracks × 5 req/s). The first time a track is opened (sheet, editor,
 * outing creation) the elevation is completed, then stored in the database with recomputed gain/loss/min/max:
 * later openings no longer call IGN.
 */
const attempted = new Map<string, Promise<TrackRow>>();
const MAX_ATTEMPTS_KEPT = 5000;

export const needsElevation = (t: Pick<TrackRow, 'minEle'>) => t.minEle == null;

export async function ensureTrackElevation(db: Db, t: TrackRow, opts: EnrichOptions = {}): Promise<TrackRow> {
  if (!needsElevation(t)) return t;
  // A single attempt per track and per process (points outside IGN coverage: no retry on every page);
  // two simultaneous openings share the same call.
  const key = `${t.id}:${t.updatedAt.getTime()}`;
  const running = attempted.get(key);
  if (running) return running;
  const p = (async () => {
    try {
      const geometry = await enrichElevation(t.geometry, opts);
      const s = geometryStats(geometry);
      if (s.minEle == null) return t; // IGN unavailable or outside coverage: the gain stays unknown
      const patch = { geometry, elevationGainM: s.gainM, elevationLossM: s.lossM, minEle: s.minEle, maxEle: s.maxEle };
      db.update(track).set(patch).where(eq(track.id, t.id)).run();
      return { ...t, ...patch };
    } catch {
      attempted.delete(key); // network failure: retry on the next opening
      return t;
    }
  })();
  if (attempted.size > MAX_ATTEMPTS_KEPT) attempted.clear();
  attempted.set(key, p);
  return p;
}
