import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { instanceSetting } from '@/db/schema';
import { enqueueJob } from './jobs';
import { listRegions } from './store';

/**
 * Monthly refresh scheduled by the `offline-worker` service (#1751): once a month, from the 2nd at 03:00 Europe/Paris,
 * a `refresh` job is queued (no host cron needed). The month already handled is kept in `instance_setting`.
 */
const KEY = 'offline.autoRefreshMonth';
export const REFRESH_DAY = 2;
export const REFRESH_HOUR = 3;

function parisParts(now: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return { month: `${p.year}-${p.month}`, day: Number(p.day), hour: Number(p.hour) };
}

/** Month key (`YYYY-MM`) to refresh now, or null if not due (before the 2nd 03:00 Paris, or this month already handled). */
export function refreshDue(now: Date, lastMonth: string | null): string | null {
  const { month, day, hour } = parisParts(now);
  if (month === lastMonth) return null;
  if (day < REFRESH_DAY || (day === REFRESH_DAY && hour < REFRESH_HOUR)) return null;
  return month;
}

/** Called by the worker when idle: queues the monthly refresh when due (only if a pack is enabled and built). */
export function scheduleMonthlyRefresh(db: Db, now = new Date()): boolean {
  const row = db.select().from(instanceSetting).where(eq(instanceSetting.key, KEY)).get();
  const month = refreshDue(now, row?.value ?? null);
  if (!month) return false;
  const hasPacks = listRegions(db).some((r) => r.enabled && r.built);
  const queued = hasPacks && 'job' in enqueueJob(db, { kind: 'refresh' });
  db.insert(instanceSetting).values({ key: KEY, value: month }).onConflictDoUpdate({ target: instanceSetting.key, set: { value: month } }).run();
  return queued;
}
