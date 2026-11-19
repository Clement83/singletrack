import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { leaveOuting } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Private. `POST /api/outings/<id>/leave` (#1459): leave an upcoming outing (answer "no", hidden for oneself). */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const res = leaveOuting(getDb().db, user.id, (await params).slug);
  if (res.ok) return Response.json({ ok: true });
  return Response.json({ error: res.error }, { status: res.error === 'not_found' ? 404 : 409 });
}
