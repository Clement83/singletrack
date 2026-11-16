import { bboxOf, lineLength, simplifyGeometry, type Bbox, type Position, type TrackGeometry } from '@/lib/geo';
import { difficultyFromMtbScale, type Difficulty } from '@/lib/tracks/difficulty';
import { overpassFetch, type OsmSourceOptions } from './overpass';

/**
 * Calque des singles OSM (#1372) : ways `highway=path|track` tagués `mtb:scale` (difficulté VTT d'un tronçon).
 * Logique pure ; le stockage est dans `singles-store.ts`.
 */

/** Ways retenus pour le calque. */
export const SINGLE_HIGHWAYS = ['path', 'track'] as const;
/** Tolérance de simplification à l'import (m) : invisible à l'écran, divise le volume stocké. */
export const IMPORT_TOLERANCE_M = 2;

/** Requête Overpass : tous les ways path/track avec `mtb:scale` du département (code INSEE), en un appel. */
export function buildSinglesQuery(regionCode: string, timeoutS = 300): string {
  return `[out:json][timeout:${timeoutS}];
area["boundary"="administrative"]["admin_level"="6"]["ref:INSEE"="${regionCode.replace(/[^0-9AB]/gi, '')}"]->.a;
way(area.a)["highway"~"^(${SINGLE_HIGHWAYS.join('|')})$"]["mtb:scale"];
out geom;`;
}

export type OverpassWay = {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
};

export type TrailSegment = {
  osmId: string;
  name: string | null;
  highway: string;
  mtbScale: string;
  difficulty: Difficulty | null;
  geometry: TrackGeometry;
  bbox: Bbox;
  lengthM: number;
};

/** Un way OSM → segment du calque ; `null` si ce n'est pas un single exploitable (tags ou géométrie). */
export function wayToSegment(way: OverpassWay): TrailSegment | null {
  const tags = way.tags ?? {};
  const highway = tags.highway;
  const scale = tags['mtb:scale']?.trim();
  if (!highway || !(SINGLE_HIGHWAYS as readonly string[]).includes(highway) || !scale) return null;
  // `geometry` contient des `null` pour les nœuds hors de la zone d'extraction.
  const coords = (way.geometry ?? []).filter((p): p is { lat: number; lon: number } => !!p).map((p): Position => [p.lon, p.lat]);
  if (coords.length < 2) return null;
  const geometry = simplifyGeometry({ type: 'LineString', coordinates: coords }, IMPORT_TOLERANCE_M);
  const bbox = bboxOf(geometry)!;
  return {
    osmId: `way/${way.id}`,
    name: tags.name?.trim() || null,
    highway,
    mtbScale: scale,
    difficulty: difficultyFromMtbScale(scale),
    geometry,
    bbox,
    lengthM: lineLength(coords),
  };
}

/** Segments d'une réponse Overpass (ways seulement, doublons d'id ignorés). */
export function segmentsFromOverpass(json: { elements?: { type: string }[] }): TrailSegment[] {
  const seen = new Set<string>();
  const out: TrailSegment[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== 'way') continue;
    const s = wayToSegment(el as OverpassWay);
    if (!s || seen.has(s.osmId)) continue;
    seen.add(s.osmId);
    out.push(s);
  }
  return out;
}

/** Télécharge les singles de la région (un seul appel Overpass, réessais espacés). Jamais depuis une page. */
export async function fetchSingles(regionCode: string, opts: OsmSourceOptions = {}): Promise<TrailSegment[]> {
  return segmentsFromOverpass(await overpassFetch(buildSinglesQuery(regionCode), opts));
}

/** Zoom minimal du calque : en dessous, trop de segments pour être lisibles (et servis). */
export const SINGLES_MIN_ZOOM = 11;
/** Nombre maximal de segments renvoyés par requête. */
export const SINGLES_MAX_FEATURES = 4000;

/** Tolérance de simplification (m) servie selon le zoom de la carte. */
export function toleranceForZoom(zoom: number): number {
  if (zoom >= 15) return 0;
  if (zoom >= 13) return 5;
  return 12;
}
