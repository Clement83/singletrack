import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { reopenJoinedOuting } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/**
 * Private. `POST /api/outings/<id>/open` (#1444): participant page of an outing joined with one's account.
 * Decrypts the existing link of the linked invitation (#1456, no regeneration) and returns `{ path: '/i/<token>' }`.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const r = reopenJoinedOuting(getDb().db, user.id, (await params).slug);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.error === 'linkUnavailable' ? 410 : 404 });
  return Response.json({ path: `/i/${r.token}` });
}
