import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { duplicateOuting, type DuplicateInput } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Privé, organisateur seulement. `POST /api/outings/<slug>/duplicate {date, time, trackSource}` → `{ slug }` de la nouvelle sortie (#1360). */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const body = (await req.json().catch(() => null)) as DuplicateInput | null;
  if (!body || typeof body !== 'object') return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const res = duplicateOuting(getDb().db, user.id, (await params).slug, body);
  if (res.ok) return Response.json({ slug: res.slug }, { status: 201 });
  return Response.json({ error: res.error, errors: res.errors }, { status: res.error === 'not_found' ? 404 : 422 });
}
