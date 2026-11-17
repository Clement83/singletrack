import { getDb } from '@/db';
import { readCacheHeaders, readViewer } from '@/lib/public-read';
import { getMapOutingTrack } from '@/lib/outings/map';

export const dynamic = 'force-dynamic';

/** `GET /api/outings/map/<id>` (#1596) : parcours figé + profil d'une sortie ouverte sur la carte. Mêmes droits que la liste (anonyme = `public` seulement) ; non visible ⇒ 404. Jamais de slug ni d'id de trace. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, rejected } = await readViewer(req);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  const track = getMapOutingTrack(getDb().db, user?.id ?? null, id);
  if (!track) return Response.json({ error: 'notFound' }, { status: 404 });
  return Response.json(track, { headers: readCacheHeaders(!user, 30) });
}
