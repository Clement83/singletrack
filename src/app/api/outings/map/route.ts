import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { listMapOutings, type MapBbox } from '@/lib/outings/map';

export const dynamic = 'force-dynamic';

/** Privé : `GET /api/outings/map?bbox=minLon,minLat,maxLon,maxLat` — sorties à venir visibles par le compte dans l'emprise (#1461). */
export async function GET(req: Request) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const raw = new URL(req.url).searchParams.get('bbox')?.split(',').map(Number);
  if (!raw || raw.length !== 4 || raw.some((n) => !Number.isFinite(n))) return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const outings = listMapOutings(getDb().db, user.id, raw as MapBbox);
  return Response.json({ outings });
}
