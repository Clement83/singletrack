/** Offline packs (#1738): predefined regions, bbox helpers and BRouter segment coverage. Pure functions. */

/** `[minLon, minLat, maxLon, maxLat]` */
export type Bbox = [number, number, number, number];

/** Metropolitan France regions, approximate bounding boxes (generous: a pack may overflow a border). */
export const REGION_CATALOG: readonly { id: string; name: string; bbox: Bbox }[] = [
  { id: 'auvergne-rhone-alpes', name: 'Auvergne-Rhône-Alpes', bbox: [2.06, 44.11, 7.19, 46.80] },
  { id: 'bourgogne-franche-comte', name: 'Bourgogne-Franche-Comté', bbox: [2.84, 46.15, 7.14, 48.40] },
  { id: 'bretagne', name: 'Bretagne', bbox: [-5.15, 47.28, -1.00, 48.90] },
  { id: 'centre-val-de-loire', name: 'Centre-Val de Loire', bbox: [0.05, 46.34, 3.13, 48.95] },
  { id: 'corse', name: 'Corse', bbox: [8.53, 41.33, 9.57, 43.03] },
  { id: 'grand-est', name: 'Grand Est', bbox: [3.38, 47.42, 8.24, 50.17] },
  { id: 'hauts-de-france', name: 'Hauts-de-France', bbox: [1.38, 48.84, 4.26, 51.09] },
  { id: 'ile-de-france', name: 'Île-de-France', bbox: [1.45, 48.12, 3.56, 49.24] },
  { id: 'normandie', name: 'Normandie', bbox: [-1.95, 48.18, 1.80, 50.07] },
  { id: 'nouvelle-aquitaine', name: 'Nouvelle-Aquitaine', bbox: [-1.80, 42.78, 2.61, 47.18] },
  { id: 'occitanie', name: 'Occitanie', bbox: [-0.33, 42.33, 4.85, 45.05] },
  { id: 'pays-de-la-loire', name: 'Pays de la Loire', bbox: [-2.62, 46.27, 0.92, 48.57] },
  { id: 'paca', name: 'Provence-Alpes-Côte d’Azur', bbox: [4.23, 42.98, 7.72, 45.13] },
];

export function catalogRegion(id: string) {
  return REGION_CATALOG.find((r) => r.id === id) ?? null;
}

/** Validates a bbox (finite numbers, ordered, inside the world, area not absurd). Returns null if invalid. */
export function parseBbox(input: unknown): Bbox | null {
  const arr = typeof input === 'string' ? input.split(/[\s,]+/).filter(Boolean).map(Number) : Array.isArray(input) ? input.map(Number) : null;
  if (!arr || arr.length !== 4 || arr.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = arr;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) return null;
  if ((e - w) > 30 || (n - s) > 30) return null;
  return [w, s, e, n];
}

const TILE = 5;

function tileName(lon0: number, lat0: number): string {
  return `${lon0 < 0 ? 'W' : 'E'}${Math.abs(lon0)}_${lat0 < 0 ? 'S' : 'N'}${Math.abs(lat0)}`;
}

/** BRouter `.rd5` tiles (5° × 5°, named after the south-west corner, e.g. `E5_N40`) covering the bbox. */
export function segmentsForBbox(bbox: Bbox): string[] {
  const [w, s, e, n] = bbox;
  const out: string[] = [];
  const lonEnd = Math.ceil(e / TILE) * TILE;
  const latEnd = Math.ceil(n / TILE) * TILE;
  for (let lat = Math.floor(s / TILE) * TILE; lat < latEnd; lat += TILE) {
    for (let lon = Math.floor(w / TILE) * TILE; lon < lonEnd; lon += TILE) out.push(tileName(lon, lat));
  }
  return out;
}

/** Slug for a custom region id. */
export function slugify(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** Id format accepted everywhere (also guards the file path `<DATA>/offline/<id>.pmtiles`). */
export const REGION_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
