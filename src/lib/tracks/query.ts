import { and, eq, gte, inArray, isNull, lte, like, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/db';
import { friendship, track } from '@/db/schema';
import { areFriends } from '@/lib/friends';
import { getLevels } from '@/lib/fire';
import { haversine, simplifyGeometry, type TrackGeometry } from '@/lib/geo';
import type { TrackFilters } from './filters';
import type { Difficulty } from './difficulty';
import type { TrackSourceId } from './types';

/** Tolerance (m) of the geometry served to the overview map: invisible at those zooms, ~20× lighter. */
export const MAP_TOLERANCE_M = 15;

export type TrackSummary = {
  slug: string;
  name: string;
  source: TrackSourceId;
  difficulty: Difficulty | null;
  loop: boolean;
  distanceKm: number;
  gainM: number | null;
  start: [number, number];
  bbox: [number, number, number, number];
  /** `null` in the overview (`overview`, #1428): only start points are used at that zoom. */
  geometry: TrackGeometry | null;
  /** `draft`: draft (visible only in "My tracks", #1450). */
  status: 'draft' | 'published';
  /** Codes of the crossed massifs (#1349). */
  massifs: string[];
  /** #1590: visibility, only on **one's own** tracks (absent otherwise); used for the "My tracks" badge. */
  visibility?: 'public' | 'friends' | 'private';
};

/** Maximum number of tracks served per request (#1428): beyond it, the closest to the view centre first. */
export const TRACKS_MAX_DETAIL = 400;
export const TRACKS_MAX_OVERVIEW = 5000;
const CACHE_MAX = 3000;

/** Cap of the "start points" mode (#1530): light objects without geometry (~150 bytes), fine by the tens of thousands. */
export const TRACKS_MAX_STARTS = 20000;
/** Maximum number of tracks per `/api/tracks/geometry` call. */
export const GEOMETRY_MAX_SLUGS = 100;

/** Simplification tolerance (m) by map zoom: fine when zoomed in, coarse when zoomed out. */
export function toleranceForZoom(zoom?: number): number {
  if (zoom === undefined || !Number.isFinite(zoom)) return MAP_TOLERANCE_M;
  return zoom >= 15 ? 2 : zoom >= 13 ? 5 : zoom >= 11 ? 10 : MAP_TOLERANCE_M;
}

/** Light start point of a track (#1530): everything but the geometry. */
export type TrackStart = Pick<TrackSummary, 'slug' | 'name' | 'source' | 'difficulty' | 'loop' | 'distanceKm' | 'gainM' | 'start' | 'status' | 'visibility'>;

const cache = new Map<string, TrackGeometry>();
function simplified(id: string, updatedAt: Date, g: TrackGeometry, tol = MAP_TOLERANCE_M) {
  const key = `${id}:${updatedAt.getTime()}:${tol}`;
  let s = cache.get(key);
  if (!s) {
    if (cache.size >= CACHE_MAX) cache.clear(); // memory bound: tens of thousands of tracks in France
    s = simplifyGeometry(g, tol);
    cache.set(key, s);
  }
  return s;
}

/** Tracks matching the filters, simplified geometry. `home` enables the radius filter. */
export function queryTracks(
  db: Db,
  f: TrackFilters,
  home?: { lat: number; lon: number },
  /** `openOn` (YYYY-MM-DD): drops the tracks that cross a closed massif (level 4-5) that day. */
  opts: { openOn?: string; overview?: boolean; starts?: boolean; limit?: number; userId?: string } = {},
): { tracks: TrackSummary[]; total: number } {
  const w: SQL[] = [];
  if (f.q) w.push(like(sql`lower(${track.name})`, `%${f.q.toLowerCase().replace(/[%_]/g, '')}%`));
  if (f.minKm !== undefined) w.push(gte(track.distanceM, f.minKm * 1000));
  if (f.maxKm !== undefined) w.push(lte(track.distanceM, f.maxKm * 1000));
  // Unknown gain (elevation not computed yet, #1428): not wrongly excluded by a gain filter.
  if (f.minGain !== undefined) w.push(or(isNull(track.elevationGainM), gte(track.elevationGainM, f.minGain))!);
  if (f.maxGain !== undefined) w.push(or(isNull(track.elevationGainM), lte(track.elevationGainM, f.maxGain))!);
  if (f.difficulty?.length) w.push(inArray(track.difficulty, f.difficulty));
  if (f.shape) w.push(eq(track.loop, f.shape === 'loop'));
  // "My tracks" (#1430): without a known user, nothing (never other people's tracks).
  if (f.mine) w.push(opts.userId ? eq(track.createdBy, opts.userId) : sql`0`);
  // Drafts (#1450): only in "My tracks", never in the explorer or for others.
  else w.push(eq(track.status, 'published'), trackVisibleSql(opts.userId));
  if (f.bbox) {
    const [minLon, minLat, maxLon, maxLat] = f.bbox;
    w.push(lte(track.bboxMinLon, maxLon), gte(track.bboxMaxLon, minLon), lte(track.bboxMinLat, maxLat), gte(track.bboxMaxLat, minLat));
  }
  // Phase 1: light columns (no geometry), filter, sort by distance to the view centre, cap.
  const rows = db
    .select({
      id: track.id, slug: track.slug, name: track.name, source: track.source, difficulty: track.difficulty, loop: track.loop,
      distanceM: track.distanceM, elevationGainM: track.elevationGainM, startLon: track.startLon, startLat: track.startLat,
      bboxMinLon: track.bboxMinLon, bboxMinLat: track.bboxMinLat, bboxMaxLon: track.bboxMaxLon, bboxMaxLat: track.bboxMaxLat,
      massifs: track.massifs, updatedAt: track.updatedAt, status: track.status, visibility: track.visibility, createdBy: track.createdBy,
    })
    .from(track)
    .where(w.length ? and(...w) : undefined)
    .all();
  const closed = opts.openOn ? new Set([...getLevels(db, opts.openOn)].filter(([, v]) => v.level >= 4).map(([c]) => c)) : undefined;
  let kept = rows.filter((r) => {
    if (closed?.size && r.massifs?.some((c) => closed.has(c))) return false;
    if (f.near !== undefined && home && haversine([home.lon, home.lat], [r.startLon, r.startLat]) > f.near * 1000) return false;
    return true;
  });
  const total = kept.length;
  const limit = opts.limit ?? (opts.starts ? TRACKS_MAX_STARTS : opts.overview ? TRACKS_MAX_OVERVIEW : TRACKS_MAX_DETAIL);
  if (kept.length > limit) {
    const c: [number, number] = f.bbox ? [(f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2] : home ? [home.lon, home.lat] : [rows[0].startLon, rows[0].startLat];
    kept = kept
      .map((r) => ({ r, d: haversine(c, [r.startLon, r.startLat]) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map((x) => x.r);
  }
  // Phase 2: the geometry only for the kept tracks (and not at all in the overview).
  const geoms = new Map<string, TrackGeometry>();
  if (!opts.overview && !opts.starts) {
    const ids = kept.filter((r) => !cache.has(`${r.id}:${r.updatedAt.getTime()}:${MAP_TOLERANCE_M}`)).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 200) {
      for (const g of db.select({ id: track.id, geometry: track.geometry }).from(track).where(inArray(track.id, ids.slice(i, i + 200))).all()) geoms.set(g.id, g.geometry);
    }
  }
  const tracks: TrackSummary[] = kept.map((r) => ({
    slug: r.slug,
    name: r.name,
    source: r.source,
    difficulty: r.difficulty,
    loop: r.loop,
    distanceKm: r.distanceM / 1000,
    gainM: r.elevationGainM,
    start: [r.startLon, r.startLat],
    bbox: [r.bboxMinLon, r.bboxMinLat, r.bboxMaxLon, r.bboxMaxLat],
    geometry: opts.overview || opts.starts ? null : simplified(r.id, r.updatedAt, geoms.get(r.id) ?? { type: 'LineString', coordinates: [] }),
    massifs: r.massifs ?? [],
    status: r.status,
    ...(opts.userId && r.createdBy === opts.userId && r.visibility ? { visibility: r.visibility } : {}),
  }));
  return { tracks, total };
}

/**
 * Simplified geometries of tracks by slug (#1530), on demand. An unknown slug or someone else's draft is
 * simply left out (never a hint of its existence). `updatedAt` is used as the route's ETag.
 */
export function getTrackGeometries(db: Db, slugs: string[], userId?: string | null, zoom?: number) {
  const tol = toleranceForZoom(zoom);
  const rows = slugs.length ? db.select().from(track).where(inArray(track.slug, slugs)).all() : [];
  const visible = rows.filter((t) => canViewTrack(db, t, userId));
  return {
    tracks: visible.map((t) => ({ slug: t.slug, geometry: simplified(t.id, t.updatedAt, t.geometry, tol) })),
    version: visible.map((t) => `${t.slug}:${t.updatedAt.getTime()}`).sort().join(','),
  };
}

export function getTrackBySlug(db: Db, slug: string) {
  return db.select().from(track).where(eq(track.slug, slug)).get();
}

/**
 * **Single access rule** for tracks (#1588). `draft`: its author only, whatever the visibility; otherwise
 * `public`: everyone (even without a session), `friends`: the author and their friends (accepted, via `areFriends`),
 * `private`: the author only. A friend on another server has no session here: not concerned.
 * The SQL version `trackVisibleSql` must stay strictly equivalent (tests: shared case table).
 */
export function canViewTrack(
  db: Db,
  t: { status: string; visibility?: string | null; createdBy: string | null },
  userId?: string | null,
): boolean {
  const isAuthor = !!userId && !!t.createdBy && t.createdBy === userId;
  if (t.status === 'draft') return isAuthor;
  const v = t.visibility ?? 'public';
  if (v === 'public') return true;
  if (isAuthor) return true;
  if (v === 'friends') return !!userId && !!t.createdBy && areFriends(db, userId, t.createdBy);
  return false;
}

/** SQL version of `canViewTrack` to filter lists (drafts: excluded here, see `queryTracks`). */
export function trackVisibleSql(userId?: string | null): SQL {
  if (!userId) return eq(track.visibility, 'public');
  return or(
    eq(track.visibility, 'public'),
    eq(track.createdBy, userId),
    and(
      eq(track.visibility, 'friends'),
      sql`exists (select 1 from ${friendship} f where f.status = 'accepted' and f.remote_actor_id is null and ((f.requester_id = ${userId} and f.addressee_id = ${track.createdBy}) or (f.addressee_id = ${userId} and f.requester_id = ${track.createdBy})))`,
    ),
  )!;
}

/** Track by slug **if** the visitor can see it (someone else's draft ⇒ `undefined`, hence 404). */
export function getVisibleTrack(db: Db, slug: string, userId?: string | null) {
  const t = getTrackBySlug(db, slug);
  return t && canViewTrack(db, t, userId) ? t : undefined;
}
