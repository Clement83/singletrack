import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { track } from '@/db/schema';
import { canEditInPlace } from './edit';
import { getTrackBySlug } from './query';

export type DeleteResult = { ok: true } | { error: 'not_found' | 'forbidden' };

/**
 * Supprime une trace de l'utilisateur (#1449) : mêmes droits que `canEditInPlace` (auteur, source maison / copie / GPX).
 * Les clés étrangères font le reste : `outing.track_id` et `track.parent_track_id` passent à NULL
 * (les sorties gardent leur `track_snapshot`, les copies gardent leur attribution).
 */
export function deleteTrack(db: Db, userId: string, slug: string): DeleteResult {
  const t = getTrackBySlug(db, slug);
  if (!t) return { error: 'not_found' };
  if (!canEditInPlace(t, userId)) return { error: 'forbidden' };
  db.delete(track).where(eq(track.id, t.id)).run();
  return { ok: true };
}
