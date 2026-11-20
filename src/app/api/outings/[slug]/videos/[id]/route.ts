import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { organizerContext } from '@/lib/outings';
import { videoHandlers } from '@/lib/outings/video-http';

export const dynamic = 'force-dynamic';

const h = videoHandlers(async (_r, p) => organizerContext(getDb().db, (await assertUser()).id, p.slug), (_r, p) => `o:${p.slug}`);
type C = { params: Promise<Record<string, string>> };
const guard = (fn: (req: Request, c: C) => Promise<Response>) => async (req: Request, c: C) => {
  try { return await fn(req, c); } catch (e) { return unauthorized(e); }
};
export const GET = guard(h.file);
export const DELETE = guard(h.remove);
