import type { FireLevel } from '@/lib/design/scales';
import { compactDate } from './dates';

export const OFFICIAL_MAP_URL = 'https://www.risque-prevention-incendie.fr/var/';
export const SOURCE_BASE = 'https://www.risque-prevention-incendie.fr/static/83';
export const MASSIFS_URL = `${SOURCE_BASE}/massifs_83.fgb`;
export const dayUrl = (date: string) => `${SOURCE_BASE}/import_data/${compactDate(date)}.json`;

export type MassifDayLevel = { level: FireLevel; extra: number };

/**
 * Reads the day's file: `{"massifs": {"835": [level, procedure], …}}`.
 * Levels: 1 green, 2 yellow, 3 orange, 4 red, 5 black (0 = no data, ignored).
 * Returns `null` if the format is not recognised — the caller then shows "data unavailable".
 */
export function parseDayFile(json: unknown): Map<string, MassifDayLevel> | null {
  const massifs = (json as { massifs?: unknown } | null)?.massifs;
  if (!massifs || typeof massifs !== 'object' || Array.isArray(massifs)) return null;
  const out = new Map<string, MassifDayLevel>();
  for (const [code, v] of Object.entries(massifs)) {
    if (!Array.isArray(v)) return null;
    const level = v[0];
    if (!Number.isInteger(level) || level < 0 || level > 5) return null;
    const extra = Number.isInteger(v[1]) ? (v[1] as number) : 0;
    if (level >= 1) out.set(code, { level: level as FireLevel, extra });
  }
  return out.size ? out : null;
}

/** Access: `ok` (green/yellow), `warn` (orange: not advised), `forbidden` (red/black). */
export function accessOf(level: FireLevel): 'ok' | 'warn' | 'forbidden' {
  return level >= 4 ? 'forbidden' : level === 3 ? 'warn' : 'ok';
}

export const worstLevel = (levels: FireLevel[]): FireLevel | undefined =>
  levels.length ? (Math.max(...levels) as FireLevel) : undefined;

/** Readable massif label: "MONTS TOULONNAIS" → "Monts Toulonnais". */
export function massifLabel(name: string): string {
  return name
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase())
    .replace(/\b(Des|De|Du|La|Le)\b/g, (w) => w.toLowerCase());
}
