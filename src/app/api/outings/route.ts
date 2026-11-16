import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { createOuting, type OutingInput } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Privé. `POST /api/outings` : crée une sortie sur une trace (qui est figée dans la sortie). */
export async function POST(req: Request) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const input = (await req.json().catch(() => null)) as OutingInput | null;
  if (!input || typeof input !== 'object') return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const res = await createOuting(getDb().db, user.id, input);
  if ('errors' in res) return Response.json({ errors: res.errors }, { status: 422 });
  if ('error' in res) return Response.json({ error: 'trackNotFound' }, { status: 404 });
  return Response.json({ slug: res.slug }, { status: 201 });
}
