import { bboxOf, lineLength, simplifyGeometry, type Bbox, type Position, type TrackGeometry } from '@/lib/geo';
import { difficultyFromMtbScale, type Difficulty } from '@/lib/tracks/difficulty';
import { overpassFetch, type OsmSourceOptions } from './overpass';

/**
 * OSM singletrack layer (#1372): `highway=path|track` ways tagged `mtb:scale` (mountain-bike difficulty of a segment).
 * Pure logic; storage lives in `singles-store.ts`.
 */

/** Ways kept for the layer. */
export const SINGLE_HIGHWAYS = ['path', 'track'] as const;
/** Simplification tolerance at import (m): invisible on screen, divides the stored volume. */
export const IMPORT_TOLERANCE_M = 2;

/** Overpass query: every path/track way with `mtb:scale` in the department (INSEE code), in one call. */
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

/** An OSM way → layer segment; `null` if it is not a usable singletrack (tags or geometry). */
export function wayToSegment(way: OverpassWay): TrailSegment | null {
  const tags = way.tags ?? {};
  const highway = tags.highway;
  const scale = tags['mtb:scale']?.trim();
  if (!highway || !(SINGLE_HIGHWAYS as readonly string[]).includes(highway) || !scale) return null;
  // `geometry` contains `null`s for nodes outside the extraction area.
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

/** Segments of an Overpass answer (ways only, duplicate ids ignored). */
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

/** Downloads the singletracks of the region (a single Overpass call, spaced retries). Never from a page. */
export async function fetchSingles(regionCode: string, opts: OsmSourceOptions = {}): Promise<TrailSegment[]> {
  return segmentsFromOverpass(await overpassFetch(buildSinglesQuery(regionCode), opts));
}

/** Minimum zoom of the layer: below it, too many segments to be readable (and served). */
export const SINGLES_MIN_ZOOM = 11;
/** Maximum number of segments returned per request. */
export const SINGLES_MAX_FEATURES = 4000;

/** Simplification tolerance (m) served according to the map zoom. */
export function toleranceForZoom(zoom: number): number {
  if (zoom >= 15) return 0;
  if (zoom >= 13) return 5;
  return 12;
}
