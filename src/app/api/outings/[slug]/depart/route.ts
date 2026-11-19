import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { ownerDepart, type OwnerChoice } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/**
 * Private. `POST /api/outings/<slug>/depart {choice: 'delete' | 'public' | 'transfer', newOwnerId?}` (#1459):
 * the owner of a private outing leaves it. Emails are sent in the background.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const body = (await req.json().catch(() => null)) as Partial<OwnerChoice> & { newOwnerId?: unknown } | null;
  if (!body || !['delete', 'public', 'transfer'].includes(String(body.choice))) return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const res = ownerDepart(getDb().db, user.id, (await params).slug, body as OwnerChoice);
  if (res.ok) return Response.json({ ok: true });
  return Response.json({ error: res.error }, { status: res.error === 'not_found' ? 404 : 422 });
}
