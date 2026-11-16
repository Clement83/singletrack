import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { track, type TrackRow } from '@/db/schema';
import { enrichElevation, geometryStats, type EnrichOptions } from '@/lib/geo';

/**
 * Altitude à la demande (#1428) : les traces importées en masse (OSM…) n'ont pas d'altitude, l'IGN n'est pas
 * interrogé à l'import (milliers de traces × 5 req/s). À la première ouverture d'une trace (fiche, éditeur,
 * création de sortie) on complète l'altitude, puis on l'enregistre en base avec D+/D-/min/max recalculés :
 * les ouvertures suivantes ne rappellent plus l'IGN.
 */
const attempted = new Map<string, Promise<TrackRow>>();
const MAX_ATTEMPTS_KEPT = 5000;

export const needsElevation = (t: Pick<TrackRow, 'minEle'>) => t.minEle == null;

export async function ensureTrackElevation(db: Db, t: TrackRow, opts: EnrichOptions = {}): Promise<TrackRow> {
  if (!needsElevation(t)) return t;
  // Une seule tentative par trace et par processus (points hors couverture IGN : on ne réessaie pas à chaque page) ;
  // deux ouvertures simultanées partagent le même appel.
  const key = `${t.id}:${t.updatedAt.getTime()}`;
  const running = attempted.get(key);
  if (running) return running;
  const p = (async () => {
    try {
      const geometry = await enrichElevation(t.geometry, opts);
      const s = geometryStats(geometry);
      if (s.minEle == null) return t; // IGN indisponible ou hors couverture : D+ reste inconnu
      const patch = { geometry, elevationGainM: s.gainM, elevationLossM: s.lossM, minEle: s.minEle, maxEle: s.maxEle };
      db.update(track).set(patch).where(eq(track.id, t.id)).run();
      return { ...t, ...patch };
    } catch {
      attempted.delete(key); // panne réseau : on pourra réessayer à la prochaine ouverture
      return t;
    }
  })();
  if (attempted.size > MAX_ATTEMPTS_KEPT) attempted.clear();
  attempted.set(key, p);
  return p;
}
