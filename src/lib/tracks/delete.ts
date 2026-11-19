import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { track } from '@/db/schema';
import { canEditInPlace } from './edit';
import { getTrackBySlug } from './query';

export type DeleteResult = { ok: true } | { error: 'not_found' | 'forbidden' };

/**
 * Deletes a track of the user (#1449): same rights as `canEditInPlace` (author, home-made / copy / GPX source).
 * Foreign keys do the rest: `outing.track_id` and `track.parent_track_id` become NULL
 * (outings keep their `track_snapshot`, copies keep their attribution).
 */
export function deleteTrack(db: Db, userId: string, slug: string): DeleteResult {
  const t = getTrackBySlug(db, slug);
  if (!t) return { error: 'not_found' };
  if (!canEditInPlace(t, userId)) return { error: 'forbidden' };
  db.delete(track).where(eq(track.id, t.id)).run();
  return { ok: true };
}
