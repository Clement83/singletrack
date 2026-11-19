import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { getManagedOuting } from '@/lib/outings';
import { kmlResponse } from '@/lib/outings/export';

export const dynamic = 'force-dynamic';

/** Private, organiser only (#1351): KML of the track frozen in the outing. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const o = getManagedOuting(getDb().db, user.id, (await params).slug);
  if (!o) return new Response('Not found', { status: 404 });
  return kmlResponse(o);
}
