import type { TrackGeometry, Position } from '@/lib/geo';
import { difficultyFromMtbScale } from '@/lib/tracks/difficulty';
import type { NormalizedTrack } from '@/lib/tracks/types';
import { stitchWays } from './stitch';

export type OverpassMember = {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role?: string;
  geometry?: ({ lat: number; lon: number } | null)[];
};

export type OverpassRelation = {
  type: 'relation';
  id: number;
  tags?: Record<string, string>;
  members?: OverpassMember[];
};

export const OSM_LICENSE = 'ODbL';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** Member roles that are not part of the route itself. */
const SKIPPED_ROLES = /^(alternative|alternate|excursion|approach|connection|variant)/i;

/** Geometry of a relation (LineString if the ways stitch into one, otherwise MultiLineString), or `null`. */
export function relationGeometry(rel: OverpassRelation): TrackGeometry | null {
  const ways: Position[][] = [];
  for (const m of rel.members ?? []) {
    if (m.type !== 'way' || !m.geometry || SKIPPED_ROLES.test(m.role ?? '')) continue;
    // `geometry` contains `null`s for nodes outside the extraction area.
    const line = m.geometry.filter((p): p is { lat: number; lon: number } => !!p).map((p): Position => [p.lon, p.lat]);
    if (line.length >= 2) ways.push(line);
  }
  const lines = stitchWays(ways);
  if (lines.length === 0) return null;
  return lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
}

/** A `route=mtb` relation → normalised track. Distance and gain are recomputed from the geometry. */
export function relationToTrack(rel: OverpassRelation): NormalizedTrack | null {
  const geometry = relationGeometry(rel);
  if (!geometry) return null;
  const tags = rel.tags ?? {};
  const scale = tags['mtb:scale'] ?? tags['mtb:scale:imba'];
  const name = tags.name?.trim() || (tags.ref ? `Parcours ${tags.ref}` : `Itinéraire VTT OSM ${rel.id}`);
  return {
    source: 'osm',
    externalId: `relation/${rel.id}`,
    sourceUrl: `https://www.openstreetmap.org/relation/${rel.id}`,
    name,
    description: tags.description?.trim() || null,
    author: tags.operator?.trim() || null,
    license: OSM_LICENSE,
    attribution: OSM_ATTRIBUTION,
    geometry,
    difficulty: difficultyFromMtbScale(scale),
    difficultyRaw: scale ? `mtb:scale=${scale}` : null,
    raw: { id: rel.id, tags },
  };
}
