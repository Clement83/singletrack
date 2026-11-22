import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { organizerContext } from '@/lib/outings';
import { musicHandler } from '@/lib/outings/recap-http';

export const dynamic = 'force-dynamic';

// Private: owner of the outing only (404 otherwise).
const h = musicHandler(async (_r, p) => organizerContext(getDb().db, (await assertUser()).id, p.slug));
export const GET = async (req: Request, c: { params: Promise<Record<string, string>> }) => {
  try { return await h(req, c); } catch (e) { return unauthorized(e); }
};
