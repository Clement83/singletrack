import { sourceEnabled } from '@/lib/config';
import type { Position, TrackGeometry } from './types';

/**
 * Service d'altimétrie de l'IGN (Géoplateforme) : API ouverte, sans clé, ressource RGE ALTI.
 * Quotas publiés : 5 requêtes/s par IP et 5000 points par requête (à revérifier avant l'exposition publique).
 * On groupe les points par requêtes de 150 (URL GET raisonnable) et on met en cache les altitudes
 * par point arrondi à ~1 m (5 décimales) pour ne jamais réinterroger deux fois le même point.
 */
export const IGN_ALTI_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
export const IGN_RESOURCE = 'ign_rge_alti_wld';
const CHUNK = 150;
const MIN_INTERVAL_MS = 220;

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type EnrichOptions = {
  fetchFn?: FetchLike;
  /** Cache partagé entre appels (clé `lon,lat` à 5 décimales). */
  cache?: Map<string, number>;
  /** Pause entre requêtes (ms) ; 0 en test. */
  intervalMs?: number;
  /**
   * #1515 : remplace l'altitude de TOUS les points par celle de l'IGN (au lieu de ne compléter que les manquantes).
   * Repli : point hors couverture ou IGN en panne → on garde l'altitude source si elle existe.
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
 * Complète l'altitude manquante d'une géométrie (OSM, certains GPX) via l'IGN.
 * Utilisée par toutes les sources. Ne touche pas une géométrie qui a déjà toutes ses altitudes.
 * Les points hors couverture (-99999) restent sans altitude ; si l'un manque, on laisse la géométrie
 * sans altitude (les statistiques D+ resteront nulles plutôt que fausses).
 */
export async function enrichElevation<G extends TrackGeometry>(g: G, opts: EnrichOptions = {}): Promise<G> {
  const lineList: Position[][] = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  const allHaveEle = lineList.every((l) => l.every(hasEle));
  if (allHaveEle && !opts.replace) return g;
  // Source `ign` désactivée (DATA_SOURCES, #1473) : pas d'appel réseau, la géométrie reste sans altitude.
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
    // IGN en panne en mode remplacement : l'altitude source (déjà complète) est conservée.
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
