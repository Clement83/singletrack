import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { archiveOuting } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Private. `POST /api/outings/<id>/archive {archived}` (#1459): archive / un-archive for oneself only. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const body = (await req.json().catch(() => null)) as { archived?: unknown } | null;
  if (!body || typeof body.archived !== 'boolean') return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const res = archiveOuting(getDb().db, user.id, (await params).slug, body.archived);
  return res.ok ? Response.json({ ok: true }) : Response.json({ error: res.error }, { status: 404 });
}
