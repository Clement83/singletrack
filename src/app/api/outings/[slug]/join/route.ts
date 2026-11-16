import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { joinVisibleOuting } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/**
 * Privé. `POST /api/outings/<id>/join` (#1444) : rejoindre avec son compte une sortie visible (« je viens »).
 * Le segment est l'**id** de la sortie telle que listée dans « Sorties ouvertes » (jamais le slug organisateur).
 * 404 générique si inconnue, non visible ou révoquée.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const res = joinVisibleOuting(getDb().db, user.id, (await params).slug);
  if (res.ok) return Response.json({ ok: true, already: res.already }, { status: res.already ? 200 : 201 });
  return Response.json({ error: res.error }, { status: res.error === 'not_found' ? 404 : 409 });
}
