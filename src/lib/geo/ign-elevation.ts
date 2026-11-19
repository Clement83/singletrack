import { sourceEnabled } from '@/lib/config';
import type { Position, TrackGeometry } from './types';

/**
 * IGN elevation service (Géoplateforme): open API, no key, RGE ALTI resource.
 * Published quotas: 5 requests/s per IP and 5000 points per request (to re-check before public exposure).
 * Points are grouped in requests of 150 (reasonable GET URL) and elevations are cached
 * per point rounded to ~1 m (5 decimals) so the same point is never queried twice.
 */
export const IGN_ALTI_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
export const IGN_RESOURCE = 'ign_rge_alti_wld';
const CHUNK = 150;
const MIN_INTERVAL_MS = 220;

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type EnrichOptions = {
  fetchFn?: FetchLike;
  /** Cache shared between calls (key `lon,lat` with 5 decimals). */
  cache?: Map<string, number>;
  /** Pause between requests (ms); 0 in tests. */
  intervalMs?: number;
  /**
   * #1515: replaces the elevation of ALL points with IGN's (instead of only filling the missing ones).
   * Fallback: point outside coverage or IGN down → the source elevation is kept if it exists.
   */
  replace?: boolean;
};

const defaultCache = new Map<string, number>();
const key = (p: Position) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
const hasEle = (p: Position) => typeof p[2] === 'number' && !Number.isNaN(p[2]);

async function fetchChunk(points: Position[], fetchFn: FetchLike): Promise<number[]> {
  const lon = points.map((p) => p[0].toFixed(5)).join('|');
  const lat = points.map((p) => p[1].toFixed(5)).join('|');
  const url = `${IGN_ALTI_URL}?lon=${lon}&lat=${lat}&resource=${IGN_RESOURCE}&zonly=true`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`IGN altimétrie : HTTP ${res.status}`);
  const body = (await res.json()) as { elevations?: number[] };
  if (!Array.isArray(body.elevations) || body.elevations.length !== points.length) {
    throw new Error('IGN altimétrie : réponse inattendue');
  }
  return body.elevations;
}

/**
 * Fills the missing elevation of a geometry (OSM, some GPX) through IGN.
 * Used by every source. Does not touch a geometry that already has all its elevations.
 * Points outside coverage (-99999) stay without elevation; if one is missing, the geometry is left
 * without elevation (gain statistics stay null rather than wrong).
 */
export async function enrichElevation<G extends TrackGeometry>(g: G, opts: EnrichOptions = {}): Promise<G> {
  const lineList: Position[][] = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  const allHaveEle = lineList.every((l) => l.every(hasEle));
  if (allHaveEle && !opts.replace) return g;
  // `ign` source disabled (DATA_SOURCES, #1473): no network call, the geometry stays without elevation.
  if (!opts.fetchFn && !sourceEnabled('ign')) return g;

  const cache = opts.cache ?? defaultCache;
  const fetchFn = opts.fetchFn ?? ((u: string) => fetch(u));
  const interval = opts.intervalMs ?? MIN_INTERVAL_MS;

  const todo = new Map<string, Position>();
  for (const l of lineList) for (const p of l) if (!cache.has(key(p))) todo.set(key(p), p);
  const entries = [...todo.entries()];
  try {
    for (let i = 0; i < entries.length; i += CHUNK) {
      const part = entries.slice(i, i + CHUNK);
      const eles = await fetchChunk(part.map(([, p]) => p), fetchFn);
      part.forEach(([k], j) => cache.set(k, eles[j]));
      if (interval && i + CHUNK < entries.length) await new Promise((r) => setTimeout(r, interval));
    }
  } catch (e) {
    // IGN down in replace mode: the source elevation (already complete) is kept.
    if (opts.replace && allHaveEle) return g;
    throw e;
  }

  const fill = (l: Position[]): Position[] =>
    l.map((p) => {
      const e = cache.get(key(p));
      if (e === undefined || e <= -99000) return (opts.replace && hasEle(p) ? [p[0], p[1], p[2]] : [p[0], p[1]]) as Position;
      return [p[0], p[1], e] as Position;
    });
  const filled = lineList.map(fill);
  return (g.type === 'LineString'
    ? { type: 'LineString', coordinates: filled[0] }
    : { type: 'MultiLineString', coordinates: filled }) as G;
}
