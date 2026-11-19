import type { Db } from '@/db';
import type { FireLevel } from '@/lib/design/scales';
import { addDays, inSeason, parisDate } from './dates';
import { massifLabel, worstLevel } from './levels';
import { getDayRecord, getLevels, getMassifs } from './store';

export type MassifStatus = { code: string; name: string; level: FireLevel; extra: number };

/**
 * Situation of a track (list of crossed massifs) on a date:
 * - `unknown`: outlines not imported / massifs never computed;
 * - `none`: the track crosses no regulated massif;
 * - `off_season`: outside the restriction period (no file, normal);
 * - `pending`: in season, level not published yet (published the day before around 7 pm);
 * - `unavailable`: in season, data missing or unreadable;
 * - `ok` : niveaux connus.
 */
export type FireInfo =
  | { kind: 'unknown' | 'none' | 'off_season' | 'pending' | 'unavailable'; date: string; names: string[] }
  | { kind: 'ok'; date: string; names: string[]; worst: FireLevel; massifs: MassifStatus[] };

export function fireInfo(db: Db, codes: string[] | null | undefined, date: string, now = new Date()): FireInfo {
  const shapes = getMassifs(db);
  if (!codes || !shapes.length) return { kind: 'unknown', date, names: [] };
  const nameOf = new Map(shapes.map((m) => [m.code, massifLabel(m.name)]));
  const names = codes.map((c) => nameOf.get(c) ?? c);
  if (!codes.length) return { kind: 'none', date, names };
  const rec = getDayRecord(db, date);
  if (rec?.status === 'ok') {
    const levels = getLevels(db, date, codes);
    const massifs = codes.flatMap((c) => {
      const l = levels.get(c);
      return l ? [{ code: c, name: nameOf.get(c) ?? c, level: l.level, extra: l.extra }] : [];
    });
    const worst = worstLevel(massifs.map((m) => m.level));
    if (worst) return { kind: 'ok', date, names, worst, massifs };
    return { kind: 'unavailable', date, names };
  }
  if (!inSeason(date)) return { kind: 'off_season', date, names };
  const today = parisDate(now);
  if (date >= addDays(today, 1) && rec?.status !== 'error') return { kind: 'pending', date, names };
  return { kind: 'unavailable', date, names };
}
