import type { Position } from '@/lib/geo';
import { config } from '@/lib/config';
import { enrichElevation, type EnrichOptions } from '@/lib/geo/ign-elevation';
import { pickAlternatives } from './alternatives';
import { RIDER_SETTINGS, chooseRoute, scoreRoute, type RouteScore, type Rider } from './score';

export class RoutingError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

/** Reference "shortest" BRouter profile (#1340); the singletrack profiles (#1385) are in `RIDER_SETTINGS`. */
export const ROUTING_PROFILE = 'mtb';

/** BRouter request URL (`lonlats=lon,lat|lon,lat`). */
export function buildRouteUrl(from: [number, number], to: [number, number], base = config.brouterUrl, profile = ROUTING_PROFILE, alt = 0): string {
  const q = new URLSearchParams({
    lonlats: `${from[0]},${from[1]}|${to[0]},${to[1]}`,
    profile,
    alternativeidx: String(alt),
    format: 'geojson',
  });
  return `${base}/brouter?${q}`;
}

/** Extracts the [lon, lat, ele] line from a BRouter GeoJSON answer. */
export function parseRoute(json: unknown): Position[] {
  const geom = (json as { features?: { geometry?: { type?: string; coordinates?: unknown } }[] })?.features?.[0]?.geometry;
  if (geom?.type !== 'LineString' || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) {
    throw new RoutingError('Réponse BRouter inattendue.');
  }
  return (geom.coordinates as number[][]).map((c) =>
    Number.isFinite(c[2]) ? ([c[0], c[1], c[2]] as Position) : ([c[0], c[1]] as Position),
  );
}

/** Computes the mountain-bike route between two points through BRouter (self-hosted, never exposed to the browser). */
export async function routeBetween(
  from: [number, number], to: [number, number], fetchImpl: typeof fetch = fetch, profile = ROUTING_PROFILE, alt = 0, ign: EnrichOptions = {},
): Promise<Position[]> {
  let res: Response;
  try {
    res = await fetchImpl(buildRouteUrl(from, to, config.brouterUrl, profile, alt), { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  } catch {
    throw new RoutingError('Le service de routage ne répond pas.', 503);
  }
  if (!res.ok) {
    // BRouter answers in plain text: "from-position not mapped in existing datafile", "no track found"...
    const msg = (await res.text().catch(() => '')).trim().slice(0, 200);
    throw new RoutingError(msg || 'Itinéraire introuvable.', res.status === 400 ? 422 : 502);
  }
  return withIgnElevation(parseRoute(await res.json().catch(() => null)), ign);
}

/**
 * #1516: BRouter's elevation (SRTM) is replaced by IGN's right at routing time, so that the live profile and gain
 * (and the scoring of alternatives) are those of the saved track (#1515). Shared cache; if IGN does not answer,
 * BRouter's elevation is kept.
 */
export async function withIgnElevation(coordinates: Position[], ign: EnrichOptions = {}): Promise<Position[]> {
  try {
    const g = await enrichElevation({ type: 'LineString', coordinates }, { replace: true, ...ign });
    return g.coordinates;
  } catch {
    return coordinates;
  }
}

/** Candidates computed in parallel (#1385): the shortest (`mtb`) and the rider's profile with its alternatives. */
export function candidateRequests(rider: Rider): { profile: string; alt: number }[] {
  const p = RIDER_SETTINGS[rider].profile;
  return [{ profile: ROUTING_PROFILE, alt: 0 }, { profile: p, alt: 0 }, { profile: p, alt: 1 }, { profile: p, alt: 2 }];
}

export type ScoredRoute = { coordinates: Position[]; profile: string; alt: number; score: RouteScore };

/**
 * Scored route (#1385): every candidate, the best one according to `chooseRoute`, and the justification to show
 * when it differs from the shortest ("+0.9 km, −140 m of gain"). A failing candidate is ignored; all
 * failing ⇒ the first one's error.
 */
export async function routeScored(from: [number, number], to: [number, number], rider: Rider, fetchImpl: typeof fetch = fetch, ign: EnrichOptions = {}) {
  const reqs = candidateRequests(rider);
  const settled = await Promise.allSettled(reqs.map((r) => routeBetween(from, to, fetchImpl, r.profile, r.alt, ign)));
  const ok: ScoredRoute[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') ok.push({ coordinates: s.value, ...reqs[i], score: scoreRoute({ type: 'LineString', coordinates: s.value }, rider) });
  });
  if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
  // Duplicates (same length to the metre): the first one is kept.
  const unique = ok.filter((c, i) => ok.findIndex((d) => Math.abs(d.score.km - c.score.km) < 0.001 && d.score.gainM === c.score.gainM) === i);
  const { best, shortest } = chooseRoute(unique.map((c) => ({ route: c, score: c.score })), rider);
  const note = best.route === shortest.route ? null : {
    extraKm: best.score.km - shortest.score.km,
    gainSavedM: shortest.score.gainM !== null && best.score.gainM !== null ? shortest.score.gainM - best.score.gainM : null,
  };
  return { best: best.route, candidates: unique, note, alternatives: pickAlternatives(best.route, unique) };
}
