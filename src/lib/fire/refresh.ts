import type { Db } from '@/db';
import { addDays, parisDate, parisHour } from './dates';
import { readMassifsFgb } from './fgb';
import { backfillTrackMassifs, fetchDay, fetchMassifsFile, getMassifs, saveMassifs, shouldFetch, type Fetcher } from './store';

/** Imports the outlines (once per season) then recomputes the massifs crossed by each track. */
export async function syncMassifs(db: Db, load: () => Promise<ArrayBuffer> = fetchMassifsFile): Promise<{ massifs: number; tracks: number }> {
  const massifs = saveMassifs(db, await readMassifsFgb(await load()));
  return { massifs, tracks: backfillTrackMassifs(db) };
}

/**
 * Daily pass: outlines if missing, then today's and tomorrow's levels.
 * Called at start-up and every hour by the scheduler; most passes make no network call.
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

/** Internal scheduler (no external cron): first pass 20 s after start-up, then every hour. */
export function startFireScheduler(db: Db) {
  if (timer) return;
  const tick = () => void refreshFire(db).catch((e) => console.error('[fire]', e));
  setTimeout(tick, 20_000).unref();
  timer = setInterval(tick, 3_600_000);
  timer.unref();
}
