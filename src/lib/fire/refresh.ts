import type { Db } from '@/db';
import { addDays, parisDate, parisHour } from './dates';
import { readMassifsFgb } from './fgb';
import { backfillTrackMassifs, fetchDay, fetchMassifsFile, getMassifs, saveMassifs, shouldFetch, type Fetcher } from './store';

/** Importe les contours (une fois par saison) puis recalcule les massifs traversés de chaque trace. */
export async function syncMassifs(db: Db, load: () => Promise<ArrayBuffer> = fetchMassifsFile): Promise<{ massifs: number; tracks: number }> {
  const massifs = saveMassifs(db, await readMassifsFgb(await load()));
  return { massifs, tracks: backfillTrackMassifs(db) };
}

/**
 * Passe quotidienne : contours si absents, puis niveaux d'aujourd'hui et de demain.
 * Appelée au démarrage et chaque heure par le planificateur ; la plupart des passes ne font aucun appel réseau.
 */
export async function refreshFire(db: Db, now = new Date(), fetcher?: Fetcher): Promise<string[]> {
  const done: string[] = [];
  if (!getMassifs(db).length) {
    try {
      await syncMassifs(db);
      done.push('massifs');
    } catch (e) {
      console.error(`[fire] contours : ${e instanceof Error ? e.message : e}`);
    }
  }
  const today = parisDate(now);
  const hour = parisHour(now);
  for (const date of [today, addDays(today, 1)]) {
    if (shouldFetch(db, date, today, hour, now)) done.push(`${date}:${await fetchDay(db, date, fetcher, now)}`);
  }
  return done;
}

let timer: NodeJS.Timeout | undefined;

/** Planificateur interne (pas de cron externe) : première passe 20 s après le démarrage, puis toutes les heures. */
export function startFireScheduler(db: Db) {
  if (timer) return;
  const tick = () => void refreshFire(db).catch((e) => console.error('[fire]', e));
  setTimeout(tick, 20_000).unref();
  timer = setInterval(tick, 3_600_000);
  timer.unref();
}
