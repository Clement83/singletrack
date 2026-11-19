import type { TrackGeometry } from '@/lib/geo';
import type { TRACK_SOURCES } from '@/db/schema';
import type { Difficulty } from './difficulty';

export type TrackSourceId = (typeof TRACK_SOURCES)[number];

/** Area to sync (v1: the Var). */
export type RegionConfig = {
  code: string;
  center: { lat: number; lon: number };
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
};

/** A track as provided by a source: only the geometry and the original metadata. */
export type NormalizedTrack = {
  source: TrackSourceId;
  externalId: string | null;
  sourceUrl?: string | null;
  name: string;
  description?: string | null;
  author?: string | null;
  license?: string | null;
  attribution?: string | null;
  geometry: TrackGeometry;
  difficulty?: Difficulty | null;
  difficultyRaw?: string | null;
  sourceUpdatedAt?: Date | null;
  /** User who imported/created the track (gpx / home-made tracks). */
  createdBy?: string | null;
  /** Edited copy (#1340): id of the original track. */
  parentTrackId?: string | null;
  /** `draft` (#1450): its author's draft; absent = published. */
  status?: 'draft' | 'published';
  /** #1588: absent = `public` (or unchanged on update). Forced to `public` for synced sources. */
  visibility?: 'public' | 'friends' | 'private';
  raw?: unknown;
};

/** Common contract of the sources (OSM, GPX, Utagawa, Geotrek, DATAtourisme): the rest of the app does not tell them apart. */
export interface TrackSource {
  id: 'utagawa' | 'osm' | 'geotrek' | 'gpx' | 'datatourisme';
  /** Bulk import / update of a region. */
  sync(region: RegionConfig): AsyncIterable<NormalizedTrack>;
}
