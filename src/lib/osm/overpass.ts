import type { RegionConfig, TrackSource } from '@/lib/tracks';
import { relationToTrack, type OverpassRelation } from './relation';

export const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Requête Overpass : toutes les relations `route=mtb` du département (code INSEE), géométrie incluse. */
export function buildQuery(regionCode: string, timeoutS = 180): string {
  return `[out:json][timeout:${timeoutS}];
area["boundary"="administrative"]["admin_level"="6"]["ref:INSEE"="${regionCode.replace(/[^0-9AB]/gi, '')}"]->.a;
relation(area.a)["route"="mtb"];
out geom;`;
}

export type OsmSourceOptions = {
  url?: string;
  fetchImpl?: typeof fetch;
  /** Abandon de la requête (ms). */
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

/**
 * Un appel Overpass (POST `data=`) avec un User-Agent générique (fair use) et des réessais espacés en cas de
 * 429/5xx (serveur saturé). Partagé par la synchro des itinéraires (#1336) et celle des singles (#1372).
 */
export async function overpassFetch<T>(query: string, opts: OsmSourceOptions = {}): Promise<T> {
  const url = opts.url ?? process.env.OVERPASS_URL ?? DEFAULT_OVERPASS_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 3;
  const body = new URLSearchParams({ data: query });
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await doFetch(url, {
        method: 'POST',
        body,
        headers: { 'User-Agent': 'singletrack-sync/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 240_000),
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastError = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, (opts.retryDelayMs ?? 30_000) * (attempt + 1)));
    }
  }
  throw lastError;
}

/** Source OSM (Overpass) : un seul appel par synchro. Jamais appelée au chargement d'une page. */
export function osmSource(opts: OsmSourceOptions = {}): TrackSource {
  return {
    id: 'osm',
    async *sync(region: RegionConfig) {
      const json = await overpassFetch<{ elements?: OverpassRelation[] }>(buildQuery(region.code), opts);
      for (const el of json.elements ?? []) {
        if (el.type !== 'relation') continue;
        const t = relationToTrack(el);
        if (t) yield t;
      }
    },
  };
}
