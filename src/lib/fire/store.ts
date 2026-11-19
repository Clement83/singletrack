import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db';
import { massif, massifDay, massifLevel, track } from '@/db/schema';
import type { TrackGeometry } from '@/lib/geo';
import { compactDate, inSeason } from './dates';
import { bboxOfMassif, massifsCrossed, type MassifShape } from './geometry';
import { dayUrl, MASSIFS_URL, parseDayFile, type MassifDayLevel } from './levels';
import type { MassifFeature } from './types';

const cache = new WeakMap<Db, MassifShape[]>();

/** Massifs in the database (memoised: ~100 KB of polygons). Empty until `sync:massifs` has run. */
export function getMassifs(db: Db): MassifShape[] {
  let m = cache.get(db);
  if (!m) {
    m = db
      .select()
      .from(massif)
      .all()
      .map((r) => ({ code: r.code, name: r.name, geometry: r.geometry, bbox: [r.bboxMinLon, r.bboxMinLat, r.bboxMaxLon, r.bboxMaxLat] as MassifShape['bbox'] }));
    if (m.length) cache.set(db, m);
  }
  return m;
}

/** Replaces the massif outlines. */
export function saveMassifs(db: Db, features: MassifFeature[]): number {
  db.transaction((tx) => {
    tx.delete(massif).run();
    for (const f of features) {
      const [a, b, c, d] = bboxOfMassif(f.geometry);
      tx.insert(massif).values({ code: f.code, name: f.name, geometry: f.geometry, bboxMinLon: a, bboxMinLat: b, bboxMaxLon: c, bboxMaxLat: d }).run();
    }
  });
  cache.delete(db);
  return features.length;
}

/** Massifs crossed by a geometry; `null` if the outlines are not imported yet. */
export function massifsForGeometry(db: Db, g: TrackGeometry): string[] | null {
  const m = getMassifs(db);
  return m.length ? massifsCrossed(g, m) : null;
}

/** Recomputes the crossed massifs of every track (after importing the outlines). */
export function backfillTrackMassifs(db: Db): number {
  const rows = db.select({ id: track.id, geometry: track.geometry }).from(track).all();
  const shapes = getMassifs(db);
  for (const r of rows) db.update(track).set({ massifs: massifsCrossed(r.geometry, shapes) }).where(eq(track.id, r.id)).run();
  return rows.length;
}

// ---- Niveaux par jour ----

export type DayRecord = { status: 'ok' | 'none' | 'error'; fetchedAt: Date } | undefined;

export function getDayRecord(db: Db, date: string): DayRecord {
  return db.select({ status: massifDay.status, fetchedAt: massifDay.fetchedAt }).from(massifDay).where(eq(massifDay.date, date)).get();
}

export function saveDay(db: Db, date: string, status: 'ok' | 'none' | 'error', levels?: Map<string, MassifDayLevel>, now = new Date()) {
  db.transaction((tx) => {
    tx.delete(massifLevel).where(eq(massifLevel.date, date)).run();
    if (status === 'ok' && levels) {
      for (const [code, v] of levels) tx.insert(massifLevel).values({ date, massifCode: code, level: v.level, extra: v.extra }).run();
    }
    tx.insert(massifDay).values({ date, status, fetchedAt: now }).onConflictDoUpdate({ target: massifDay.date, set: { status, fetchedAt: now } }).run();
  });
}

/** Levels of a day, by massif code; empty if no data. */
export function getLevels(db: Db, date: string, codes?: string[]): Map<string, MassifDayLevel> {
  const rows = db
    .select()
    .from(massifLevel)
    .where(codes ? and(eq(massifLevel.date, date), inArray(massifLevel.massifCode, codes)) : eq(massifLevel.date, date))
    .all();
  return new Map(rows.map((r) => [r.massifCode, { level: r.level as MassifDayLevel['level'], extra: r.extra }]));
}

// ---- Fetching (never from a page: daily job only) ----

export type Fetcher = (url: string) => Promise<{ status: number; text: () => Promise<string> }>;
const defaultFetch: Fetcher = (url) => fetch(url, { headers: { 'User-Agent': 'singletrack/1.0', Accept: '*/*' }, signal: AbortSignal.timeout(20_000) });

/** Fetches a day's file. Absent (404) = no restriction published; unknown format = error. */
export async function fetchDay(db: Db, date: string, fetcher: Fetcher = defaultFetch, now = new Date()): Promise<'ok' | 'none' | 'error'> {
  try {
    const res = await fetcher(dayUrl(date));
    if (res.status === 404) return (saveDay(db, date, 'none', undefined, now), 'none');
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const levels = parseDayFile(JSON.parse(await res.text()));
    if (!levels) throw new Error('format inattendu');
    saveDay(db, date, 'ok', levels, now);
    return 'ok';
  } catch (e) {
    console.error(`[fire] ${compactDate(date)} : ${e instanceof Error ? e.message : e}`);
    saveDay(db, date, 'error', undefined, now);
    return 'error';
  }
}

const HOUR = 3_600_000;

/**
 * Should the prefecture be queried for this day? A single useful call per day:
 * - already read (`ok`) → no; out of season → no (the server is left alone from October to May);
 * - the next day is only published around 6–7 pm: not before 7 pm (Paris time);
 * - after a failure or an absence, retry at most every 3 h.
 */
export function shouldFetch(db: Db, date: string, today: string, parisHourNow: number, now: Date): boolean {
  if (!inSeason(date)) return false;
  const rec = getDayRecord(db, date);
  if (rec?.status === 'ok') return false;
  if (date > today && parisHourNow < 19) return false;
  return !rec || now.getTime() - rec.fetchedAt.getTime() >= 3 * HOUR;
}

export async function fetchMassifsFile(fetcher: (url: string) => Promise<ArrayBuffer> = async (u) => {
  const r = await fetch(u, { headers: { 'User-Agent': 'singletrack/1.0' }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.arrayBuffer();
}): Promise<ArrayBuffer> {
  return fetcher(MASSIFS_URL);
}
