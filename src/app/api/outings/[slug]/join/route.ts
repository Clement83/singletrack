import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { joinVisibleOuting } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/**
 * Private. `POST /api/outings/<id>/join` (#1444): join a visible outing with one's account ("I'm in").
 * The segment is the **id** of the outing as listed in "Open outings" (never the organiser slug).
 * Generic 404 if unknown, not visible or revoked.
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
