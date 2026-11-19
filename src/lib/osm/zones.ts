import { sourceEnabled } from '@/lib/config';

/**
 * OSM sync areas (#1428): the departments of metropolitan France (INSEE code).
 * An Overpass call for the whole of France would time out; so one area is queried at a time, sequentially.
 */
export const FR_DEPARTMENTS: readonly string[] = [
  ...Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(2, '0')),
  '2A',
  '2B',
  ...Array.from({ length: 75 }, (_, i) => String(i + 21).padStart(2, '0')),
];

/** Normalised INSEE code ("6" → "06", "2a" → "2A"); `null` if it is not a metropolitan department. */
export function normalizeZone(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  const code = /^\d$/.test(s) ? `0${s}` : s;
  return FR_DEPARTMENTS.includes(code) ? code : null;
}

/**
 * Areas requested on the command line (`83 06 2A`, or `all`); without arguments, `SYNC_ZONES` (#1473, `defaults`),
 * and all of France if that variable is empty.
 */
export function parseZones(args: string[], defaults: readonly string[] = []): { zones: string[]; invalid: string[] } {
  const given = args.flatMap((a) => a.split(',')).filter((a) => a && a !== '--');
  const wanted = given.length ? given : [...defaults];
  if (wanted.length === 0 || wanted.includes('all')) return { zones: [...FR_DEPARTMENTS], invalid: [] };
  const zones: string[] = [];
  const invalid: string[] = [];
  for (const w of wanted) {
    const z = normalizeZone(w);
    if (!z) invalid.push(w);
    else if (!zones.includes(z)) zones.push(z);
  }
  return { zones, invalid };
}

/** Approximate extent of the Var (fire and hunting only apply there, #1428). */
export const VAR_BBOX = { minLon: 5.65, minLat: 42.95, maxLon: 7.15, maxLat: 43.9 };

export function inVar(lon: number, lat: number): boolean {
  return lon >= VAR_BBOX.minLon && lon <= VAR_BBOX.maxLon && lat >= VAR_BBOX.minLat && lat <= VAR_BBOX.maxLat;
}

/** Fire risk applies here: in the Var and `fire83` source active (#1473). */
export function fireApplies(lon: number, lat: number): boolean {
  return sourceEnabled('fire83') && inVar(lon, lat);
}

/** Driven hunts apply here: in the Var and `hunting83` source active (#1473). */
export function huntingApplies(lon: number, lat: number): boolean {
  return sourceEnabled('hunting83') && inVar(lon, lat);
}
