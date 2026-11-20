import type { Difficulty } from '@/lib/tracks/difficulty';

/**
 * Pure helpers of the singles tooltip (#1687): OSM tag values → keys of the `singles.*` messages.
 * Unknown values fall back to the raw tag (never hidden).
 */

/** `mtb:scale` ("2", "1+", "3-") → level 0–5 (S6 and above are clamped to S5); null if not numeric. */
export function scaleLevel(scale: string | null | undefined): number | null {
  if (!scale) return null;
  const n = Number.parseInt(scale, 10);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.min(n, 5);
}

/** Surface values explained in `singles.surface.*`. */
export const KNOWN_SURFACES = [
  'asphalt', 'paved', 'concrete', 'paving_stones', 'compacted', 'fine_gravel', 'gravel', 'ground', 'dirt', 'earth',
  'grass', 'sand', 'mud', 'rock', 'pebblestone', 'wood', 'unpaved',
] as const;

/** Message key of a `surface` value, or null when unknown (the caller shows the raw value). OSM may list `a;b`: first value. */
export function surfaceKey(surface: string | null | undefined): (typeof KNOWN_SURFACES)[number] | null {
  const v = surface?.split(';')[0]?.trim().toLowerCase();
  return (KNOWN_SURFACES as readonly string[]).includes(v ?? '') ? (v as (typeof KNOWN_SURFACES)[number]) : null;
}

/** `https://www.openstreetmap.org/way/<id>` from the stored key `way/<id>`; null if malformed. */
export function osmWayUrl(osmId: string): string | null {
  const m = /^way\/(\d+)$/.exec(osmId);
  return m ? `https://www.openstreetmap.org/way/${m[1]}` : null;
}

/** Display data of one tooltip, read from the GeoJSON feature properties. */
export type SingleInfo = {
  id: string;
  name: string | null;
  difficulty: Difficulty | 'none';
  level: number | null;
  uphillLevel: number | null;
  surface: string | null;
  lengthKm: number;
  url: string | null;
};

export function singleInfo(p: { id: string; difficulty: Difficulty | 'none'; scale: string; name: string | null; surface?: string | null; uphill?: string | null; lengthM: number }): SingleInfo {
  return {
    id: p.id,
    name: p.name?.trim() || null,
    difficulty: p.difficulty,
    level: scaleLevel(p.scale),
    uphillLevel: scaleLevel(p.uphill),
    surface: p.surface?.trim() || null,
    lengthKm: p.lengthM / 1000,
    url: osmWayUrl(p.id),
  };
}
