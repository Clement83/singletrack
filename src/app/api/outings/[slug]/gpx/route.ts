import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { getManagedOuting } from '@/lib/outings';
import { gpxResponse } from '@/lib/outings/export';

export const dynamic = 'force-dynamic';

/** Privé, organisateur seulement (#1351) : GPX de la trace figée dans la sortie. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const o = getManagedOuting(getDb().db, user.id, (await params).slug);
  if (!o) return new Response('Not found', { status: 404 });
  return gpxResponse(o);
}
