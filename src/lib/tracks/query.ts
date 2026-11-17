import { and, eq, gte, inArray, isNull, lte, like, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/db';
import { friendship, track } from '@/db/schema';
import { areFriends } from '@/lib/friends';
import { getLevels } from '@/lib/fire';
import { haversine, simplifyGeometry, type TrackGeometry } from '@/lib/geo';
import type { TrackFilters } from './filters';
import type { Difficulty } from './difficulty';
import type { TrackSourceId } from './types';

/** Tolérance (m) de la géométrie servie à la carte d'ensemble : invisible à ces zooms, ~20× plus léger. */
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
  /** `null` en vue d'ensemble (`overview`, #1428) : seuls les points de départ servent à ce zoom. */
  geometry: TrackGeometry | null;
  /** `draft` : brouillon (visible seulement dans « Mes traces », #1450). */
  status: 'draft' | 'published';
  /** Codes des massifs traversés (#1349). */
  massifs: string[];
  /** #1590 : visibilité, seulement sur **ses propres** traces (absente sinon) ; sert au badge de « Mes traces ». */
  visibility?: 'public' | 'friends' | 'private';
};

/** Nombre maximal de traces servies par requête (#1428) : au-delà, les plus proches du centre de la vue d'abord. */
export const TRACKS_MAX_DETAIL = 400;
export const TRACKS_MAX_OVERVIEW = 5000;
const CACHE_MAX = 3000;

/** Plafond du mode « départs » (#1530) : objets légers sans géométrie (~150 octets), tolérables par dizaines de milliers. */
export const TRACKS_MAX_STARTS = 20000;
/** Nombre maximal de traces par appel de `/api/tracks/geometry`. */
export const GEOMETRY_MAX_SLUGS = 100;

/** Tolérance de simplification (m) selon le zoom de la carte : fine en vue rapprochée, grossière en vue large. */
export function toleranceForZoom(zoom?: number): number {
  if (zoom === undefined || !Number.isFinite(zoom)) return MAP_TOLERANCE_M;
  return zoom >= 15 ? 2 : zoom >= 13 ? 5 : zoom >= 11 ? 10 : MAP_TOLERANCE_M;
}

/** Départ léger d'une trace (#1530) : tout sauf la géométrie. */
export type TrackStart = Pick<TrackSummary, 'slug' | 'name' | 'source' | 'difficulty' | 'loop' | 'distanceKm' | 'gainM' | 'start' | 'status' | 'visibility'>;

const cache = new Map<string, TrackGeometry>();
function simplified(id: string, updatedAt: Date, g: TrackGeometry, tol = MAP_TOLERANCE_M) {
  const key = `${id}:${updatedAt.getTime()}:${tol}`;
  let s = cache.get(key);
  if (!s) {
    if (cache.size >= CACHE_MAX) cache.clear(); // borne mémoire : des dizaines de milliers de traces en France
    s = simplifyGeometry(g, tol);
    cache.set(key, s);
  }
  return s;
}

/** Traces correspondant aux filtres, géométrie simplifiée. `home` active le filtre de rayon. */
export function queryTracks(
  db: Db,
  f: TrackFilters,
  home?: { lat: number; lon: number },
  /** `openOn` (YYYY-MM-DD) : écarte les traces qui traversent un massif fermé (niveau 4-5) ce jour-là. */
  opts: { openOn?: string; overview?: boolean; starts?: boolean; limit?: number; userId?: string } = {},
): { tracks: TrackSummary[]; total: number } {
  const w: SQL[] = [];
  if (f.q) w.push(like(sql`lower(${track.name})`, `%${f.q.toLowerCase().replace(/[%_]/g, '')}%`));
  if (f.minKm !== undefined) w.push(gte(track.distanceM, f.minKm * 1000));
  if (f.maxKm !== undefined) w.push(lte(track.distanceM, f.maxKm * 1000));
  // D+ inconnu (altitude pas encore calculée, #1428) : on ne l'exclut pas à tort d'un filtre de D+.
  if (f.minGain !== undefined) w.push(or(isNull(track.elevationGainM), gte(track.elevationGainM, f.minGain))!);
  if (f.maxGain !== undefined) w.push(or(isNull(track.elevationGainM), lte(track.elevationGainM, f.maxGain))!);
  if (f.difficulty?.length) w.push(inArray(track.difficulty, f.difficulty));
  if (f.shape) w.push(eq(track.loop, f.shape === 'loop'));
  // « Mes traces » (#1430) : sans utilisateur connu, rien (jamais les traces des autres).
  if (f.mine) w.push(opts.userId ? eq(track.createdBy, opts.userId) : sql`0`);
  // Brouillons (#1450) : seulement dans « Mes traces », jamais dans l'explorateur ni chez les autres.
  else w.push(eq(track.status, 'published'), trackVisibleSql(opts.userId));
  if (f.bbox) {
    const [minLon, minLat, maxLon, maxLat] = f.bbox;
    w.push(lte(track.bboxMinLon, maxLon), gte(track.bboxMaxLon, minLon), lte(track.bboxMinLat, maxLat), gte(track.bboxMaxLat, minLat));
  }
  // Phase 1 : colonnes légères (sans la géométrie), filtre, tri par proximité du centre de la vue, plafond.
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
  // Phase 2 : la géométrie seulement pour les traces gardées (et pas du tout en vue d'ensemble).
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
 * Géométries simplifiées de traces par slug (#1530), à la demande. Un slug inconnu ou un brouillon d'un autre est
 * simplement omis (jamais d'indice sur son existence). `updatedAt` sert d'ETag côté route.
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
 * **Règle d'accès unique** aux traces (#1588). `draft` : son auteur seul, quelle que soit la visibilité ; sinon
 * `public` : tout le monde (même sans session), `friends` : l'auteur et ses copains (acceptés, via `areFriends`),
 * `private` : l'auteur seul. Un copain d'un autre serveur n'a pas de session ici : il n'est pas concerné.
 * La version SQL `trackVisibleSql` doit rester strictement équivalente (tests : table de cas commune).
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

/** Version SQL de `canViewTrack` pour filtrer les listes (brouillons : exclus ici, voir `queryTracks`). */
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

/** Trace par slug **si** le visiteur peut la voir (brouillon d'un autre ⇒ `undefined`, donc 404). */
export function getVisibleTrack(db: Db, slug: string, userId?: string | null) {
  const t = getTrackBySlug(db, slug);
  return t && canViewTrack(db, t, userId) ? t : undefined;
}
