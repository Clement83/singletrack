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

/** Profil BRouter « plus court » de référence (#1340) ; les profils singletrack (#1385) sont dans `RIDER_SETTINGS`. */
export const ROUTING_PROFILE = 'mtb';

/** URL de la requête BRouter (`lonlats=lon,lat|lon,lat`). */
export function buildRouteUrl(from: [number, number], to: [number, number], base = config.brouterUrl, profile = ROUTING_PROFILE, alt = 0): string {
  const q = new URLSearchParams({
    lonlats: `${from[0]},${from[1]}|${to[0]},${to[1]}`,
    profile,
    alternativeidx: String(alt),
    format: 'geojson',
  });
  return `${base}/brouter?${q}`;
}

/** Extrait la ligne [lon, lat, ele] d'une réponse GeoJSON BRouter. */
export function parseRoute(json: unknown): Position[] {
  const geom = (json as { features?: { geometry?: { type?: string; coordinates?: unknown } }[] })?.features?.[0]?.geometry;
  if (geom?.type !== 'LineString' || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) {
    throw new RoutingError('Réponse BRouter inattendue.');
  }
  return (geom.coordinates as number[][]).map((c) =>
    Number.isFinite(c[2]) ? ([c[0], c[1], c[2]] as Position) : ([c[0], c[1]] as Position),
  );
}

/** Calcule l'itinéraire VTT entre deux points via BRouter (auto-hébergé, jamais exposé au navigateur). */
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
    // BRouter répond en texte brut : « from-position not mapped in existing datafile », « no track found »...
    const msg = (await res.text().catch(() => '')).trim().slice(0, 200);
    throw new RoutingError(msg || 'Itinéraire introuvable.', res.status === 400 ? 422 : 502);
  }
  return withIgnElevation(parseRoute(await res.json().catch(() => null)), ign);
}

/**
 * #1516 : l'altitude BRouter (SRTM) est remplacée par celle de l'IGN dès le routage, pour que le profil et le D+ en direct
 * (et la notation des alternatives) soient ceux de la trace enregistrée (#1515). Cache partagé ; si l'IGN ne répond pas,
 * on garde l'altitude BRouter.
 */
export async function withIgnElevation(coordinates: Position[], ign: EnrichOptions = {}): Promise<Position[]> {
  try {
    const g = await enrichElevation({ type: 'LineString', coordinates }, { replace: true, ...ign });
    return g.coordinates;
  } catch {
    return coordinates;
  }
}

/** Candidats calculés en parallèle (#1385) : le plus court (`mtb`) et le profil du cycliste avec ses alternatives. */
export function candidateRequests(rider: Rider): { profile: string; alt: number }[] {
  const p = RIDER_SETTINGS[rider].profile;
  return [{ profile: ROUTING_PROFILE, alt: 0 }, { profile: p, alt: 0 }, { profile: p, alt: 1 }, { profile: p, alt: 2 }];
}

export type ScoredRoute = { coordinates: Position[]; profile: string; alt: number; score: RouteScore };

/**
 * Itinéraire noté (#1385) : tous les candidats, le meilleur selon `chooseRoute`, et la justification à afficher
 * quand il diffère du plus court (« +0,9 km, −140 m de D+ »). Un candidat en échec est ignoré ; tous en
 * échec ⇒ l'erreur du premier.
 */
export async function routeScored(from: [number, number], to: [number, number], rider: Rider, fetchImpl: typeof fetch = fetch, ign: EnrichOptions = {}) {
  const reqs = candidateRequests(rider);
  const settled = await Promise.allSettled(reqs.map((r) => routeBetween(from, to, fetchImpl, r.profile, r.alt, ign)));
  const ok: ScoredRoute[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') ok.push({ coordinates: s.value, ...reqs[i], score: scoreRoute({ type: 'LineString', coordinates: s.value }, rider) });
  });
  if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
  // Doublons (même longueur au mètre près) : on garde le premier.
  const unique = ok.filter((c, i) => ok.findIndex((d) => Math.abs(d.score.km - c.score.km) < 0.001 && d.score.gainM === c.score.gainM) === i);
  const { best, shortest } = chooseRoute(unique.map((c) => ({ route: c, score: c.score })), rider);
  const note = best.route === shortest.route ? null : {
    extraKm: best.score.km - shortest.score.km,
    gainSavedM: shortest.score.gainM !== null && best.score.gainM !== null ? shortest.score.gainM - best.score.gainM : null,
  };
  return { best: best.route, candidates: unique, note, alternatives: pickAlternatives(best.route, unique) };
}
