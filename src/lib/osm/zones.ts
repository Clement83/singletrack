import { sourceEnabled } from '@/lib/config';

/**
 * Zones de synchronisation OSM (#1428) : les départements de la France métropolitaine (code INSEE).
 * Un appel Overpass France entière dépasserait le délai ; on interroge donc une zone à la fois, séquentiellement.
 */
export const FR_DEPARTMENTS: readonly string[] = [
  ...Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(2, '0')),
  '2A',
  '2B',
  ...Array.from({ length: 75 }, (_, i) => String(i + 21).padStart(2, '0')),
];

/** Code INSEE normalisé (« 6 » → « 06 », « 2a » → « 2A ») ; `null` si ce n'est pas un département métropolitain. */
export function normalizeZone(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  const code = /^\d$/.test(s) ? `0${s}` : s;
  return FR_DEPARTMENTS.includes(code) ? code : null;
}

/**
 * Zones demandées en ligne de commande (`83 06 2A`, ou `all`) ; sans argument, `SYNC_ZONES` (#1473, `defaults`),
 * et toute la France si cette variable est vide.
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

/** Emprise approximative du Var (incendie et chasse ne valent que là, #1428). */
export const VAR_BBOX = { minLon: 5.65, minLat: 42.95, maxLon: 7.15, maxLat: 43.9 };

export function inVar(lon: number, lat: number): boolean {
  return lon >= VAR_BBOX.minLon && lon <= VAR_BBOX.maxLon && lat >= VAR_BBOX.minLat && lat <= VAR_BBOX.maxLat;
}

/** Risque incendie applicable ici : dans le Var et source `fire83` active (#1473). */
export function fireApplies(lon: number, lat: number): boolean {
  return sourceEnabled('fire83') && inVar(lon, lat);
}

/** Battues de chasse applicables ici : dans le Var et source `hunting83` active (#1473). */
export function huntingApplies(lon: number, lat: number): boolean {
  return sourceEnabled('hunting83') && inVar(lon, lat);
}
