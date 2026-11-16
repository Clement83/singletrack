import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { commentHandlers } from '@/lib/outings/comments-http';
import { organizerContext } from '@/lib/outings';

export const dynamic = 'force-dynamic';

// Privé : propriétaire de la sortie seulement (404 sinon).
const resolve = async (_r: Request, p: Record<string, string>) => {
  const user = await assertUser();
  return organizerContext(getDb().db, user.id, p.slug);
};
const h = commentHandlers(resolve, (_r, p) => `o:${p.slug}`);
const guard = (fn: (req: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>) => async (req: Request, c: { params: Promise<Record<string, string>> }) => {
  try { return await fn(req, c); } catch (e) { return unauthorized(e); }
};
export const GET = guard(h.list);
export const POST = guard(h.create);
