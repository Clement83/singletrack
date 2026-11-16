import { assertUser, unauthorized } from '@/lib/current-user';
import { RoutingError, routeScored } from '@/lib/routing/brouter';
import { RIDERS, type Rider } from '@/lib/routing/score';

export const dynamic = 'force-dynamic';

const isPoint = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/**
 * Privé (éditeur, #1340). `POST /api/route` `{ from: [lon, lat], to: [lon, lat], rider?: 'muscle' | 'ebike' }` →
 * `{ coordinates, note, alternatives }` : l'itinéraire VTT entre deux points, altitudes IGN comprises (#1516, repli BRouter). Plusieurs candidats BRouter
 * (plus court `mtb`, profil `singletrack` ou `singletrack-vae` et ses alternatives) sont notés (#1385) ; `note`
 * explique le détour retenu (`{ extraKm, gainSavedM }`) ou vaut `null` si c'est le plus court.
 */
export async function POST(req: Request) {
  try {
    await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const body = (await req.json().catch(() => null)) as { from?: unknown; to?: unknown; rider?: unknown } | null;
  if (!body || !isPoint(body.from) || !isPoint(body.to)) return Response.json({ error: 'invalidPoints' }, { status: 400 });
  try {
    const rider: Rider = RIDERS.includes(body.rider as Rider) ? (body.rider as Rider) : 'muscle';
    const r = await routeScored([body.from[0], body.from[1]], [body.to[0], body.to[1]], rider);
    // Alternatives façon Waze (#1386) : tracé + étiquette (écart de distance, qualificatif).
    const alternatives = r.alternatives.map((a) => ({ coordinates: a.coordinates, deltaKm: a.deltaKm, quality: a.quality }));
    return Response.json({ coordinates: r.best.coordinates, note: r.note, alternatives });
  } catch (e) {
    if (e instanceof RoutingError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
