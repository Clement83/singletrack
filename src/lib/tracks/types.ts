import type { TrackGeometry } from '@/lib/geo';
import type { TRACK_SOURCES } from '@/db/schema';
import type { Difficulty } from './difficulty';

export type TrackSourceId = (typeof TRACK_SOURCES)[number];

/** Zone à synchroniser (v1 : le Var). */
export type RegionConfig = {
  code: string;
  center: { lat: number; lon: number };
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
};

/** Une trace telle que fournie par une source : seuls la géométrie et les métadonnées d'origine. */
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
  /** Utilisateur qui a importé/créé la trace (traces gpx / maison). */
  createdBy?: string | null;
  /** Copie éditée (#1340) : id de la trace d'origine. */
  parentTrackId?: string | null;
  /** `draft` (#1450) : brouillon de son auteur ; absent = publiée. */
  status?: 'draft' | 'published';
  raw?: unknown;
};

/** Contrat commun des sources (OSM, GPX, Utagawa, Geotrek) : le reste de l'appli ne les distingue pas. */
export interface TrackSource {
  id: 'utagawa' | 'osm' | 'geotrek' | 'gpx';
  /** Import en masse / mise à jour d'une région. */
  sync(region: RegionConfig): AsyncIterable<NormalizedTrack>;
}
