import { and, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '@/db';
import { track } from '@/db/schema';
import { geometryStats, haversine, type GpxFile, type TrackGeometry } from '@/lib/geo';
import type { NormalizedTrack } from './types';
import { isTrackVisibility } from '@/lib/user-profile';
import { IMPORT_ORIGINS, type ImportOriginId } from './import-origins';

export { IMPORT_ORIGINS, type ImportOriginId };

export const MAX_GPX_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 10;

export type ImportInput = {
  name: string;
  description?: string | null;
  origin: string;
  sourceUrl?: string | null;
  author?: string | null;
  license?: string | null;
  geometry: TrackGeometry;
  /** #1588: absent = the account's "imported tracks" preference. */
  visibility?: string | null;
};

export type ImportErrors = Partial<Record<'name' | 'origin' | 'sourceUrl' | 'author' | 'license' | 'geometry' | 'visibility', string>>;

const clean = (s: string | null | undefined) => s?.trim() || null;

/** Validates the form and builds the normalised track (`source = gpx`). Returns the errors per field. */
export function buildImportedTrack(i: ImportInput): { track: NormalizedTrack } | { errors: ImportErrors } {
  const errors: ImportErrors = {};
  const name = clean(i.name);
  if (!name) errors.name = 'nameRequired';
  else if (name.length > 200) errors.name = 'nameTooLong';
  if (i.visibility !== undefined && i.visibility !== null && !isTrackVisibility(i.visibility)) errors.visibility = 'visibilityInvalid';
  const origin = IMPORT_ORIGINS.find((o) => o.id === i.origin);
  if (!origin) errors.origin = 'originRequired';
  const url = clean(i.sourceUrl);
  const author = clean(i.author);
  const license = clean(i.license);
  if (url && !/^https?:\/\/\S+$/i.test(url)) errors.sourceUrl = 'urlInvalid';
  if (origin && origin.id !== 'perso') {
    if (!url && !errors.sourceUrl) errors.sourceUrl = 'urlRequired';
    if (!author) errors.author = 'authorRequired';
    if (!license) errors.license = 'licenseRequired';
  }
  const g = i.geometry;
  if (!g || !['LineString', 'MultiLineString'].includes(g.type) || geometryStats(g).distanceM < 100) {
    errors.geometry = 'geometryEmpty';
  }
  if (Object.keys(errors).length || !origin || !name) return { errors };

  const attribution =
    origin.id === 'perso'
      ? null
      : origin.id === 'autre'
        ? `Source : ${new URL(url!).hostname}${author ? ` — ${author}` : ''}`
        : `${origin.credit}${author ? ` — ${author}` : ''}`;
  return {
    track: {
      source: 'gpx',
      externalId: null,
      sourceUrl: url,
      name,
      description: clean(i.description),
      author,
      license,
      attribution,
      geometry: i.geometry,
      raw: { origin: origin.id },
    },
  };
}

/** Pre-fill values deduced from the file. */
export function prefillFromGpx(file: GpxFile): { origin: ImportOriginId; sourceUrl: string | null; author: string | null } {
  const hay = `${file.creator ?? ''} ${file.link ?? ''}`.toLowerCase();
  const hit = (['utagawa', 'visorando', 'openrunner', 'strava', 'komoot'] as const).find((k) => hay.includes(k));
  return { origin: hit ?? 'perso', sourceUrl: file.link, author: file.author };
}

export type DuplicateMatch = { slug: string; name: string; distanceKm: number };

/**
 * Probable duplicate: start within 150 m, distance within ±2 %, and neighbouring bbox (margin ~1 km).
 * Only warns: never blocks saving.
 */
export function findDuplicates(db: Db, g: TrackGeometry): DuplicateMatch[] {
  const s = geometryStats(g);
  if (!s.bbox || !s.start) return [];
  const margin = 0.01;
  const rows = db
    .select({ slug: track.slug, name: track.name, distanceM: track.distanceM, startLon: track.startLon, startLat: track.startLat })
    .from(track)
    .where(
      and(
        eq(track.status, 'published'),
        lte(track.bboxMinLon, s.bbox.maxLon + margin),
        gte(track.bboxMaxLon, s.bbox.minLon - margin),
        lte(track.bboxMinLat, s.bbox.maxLat + margin),
        gte(track.bboxMaxLat, s.bbox.minLat - margin),
      ),
    )
    .all();
  return rows
    .filter((r) => haversine(s.start!, [r.startLon, r.startLat]) <= 150 && Math.abs(r.distanceM - s.distanceM) <= 0.02 * s.distanceM)
    .map((r) => ({ slug: r.slug, name: r.name, distanceKm: r.distanceM / 1000 }));
}
