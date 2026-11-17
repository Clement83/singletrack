import { getDb } from '@/db';
import { readCacheHeaders, readViewer } from '@/lib/public-read';
import { listMapOutings, type MapBbox } from '@/lib/outings/map';

export const dynamic = 'force-dynamic';

/** Sans session (#1589) : seulement les sorties `public` ; connecté : celles que le compte voit. `GET /api/outings/map?bbox=minLon,minLat,maxLon,maxLat` — sorties à venir visibles par le compte dans l'emprise (#1461). */
export async function GET(req: Request) {
  const { user, rejected } = await readViewer(req);
  if (rejected) return rejected;
  const raw = new URL(req.url).searchParams.get('bbox')?.split(',').map(Number);
  if (!raw || raw.length !== 4 || raw.some((n) => !Number.isFinite(n))) return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const outings = listMapOutings(getDb().db, user?.id ?? null, raw as MapBbox);
  return Response.json({ outings }, { headers: readCacheHeaders(!user, 30) });
}
