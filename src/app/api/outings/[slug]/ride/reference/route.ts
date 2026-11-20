import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { organizerContext } from '@/lib/outings';
import { referenceHandler } from '@/lib/outings/recap-http';

export const dynamic = 'force-dynamic';

// Private: owner of the outing only. Picks which ridden track feeds the outing recap (#1692).
const put = referenceHandler(async (_r, p) => organizerContext(getDb().db, (await assertUser()).id, p.slug));
export const PUT = async (req: Request, c: { params: Promise<Record<string, string>> }) => {
  try { return await put(req, c); } catch (e) { return unauthorized(e); }
};
