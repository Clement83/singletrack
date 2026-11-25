import { assertUser, unauthorized } from '@/lib/current-user';
import { isJoinedRemote, remoteRideDelete, remoteRideList, remoteRideUpload } from '@/lib/federation/rides-http';

export const dynamic = 'force-dynamic';

/**
 * Private (#1779): my ridden track on an outing from another server I joined (404 otherwise). Same behaviour and answers as the
 * companion-app route `/api/app/outings/<id>/ride`; `federated` says whether the organiser's server received it.
 */
type Ctx = { params: Promise<{ id: string }> };
async function guarded(c: Ctx, fn: (userId: string, id: string) => Promise<Response> | Response) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const id = (await c.params).id;
  if (!isJoinedRemote(user.id, id)) return Response.json({ error: 'not_found' }, { status: 404 });
  return fn(user.id, id);
}
export const GET = (_req: Request, c: Ctx) => guarded(c, (u, id) => remoteRideList(u, id));
export const POST = (req: Request, c: Ctx) => guarded(c, (u, id) => remoteRideUpload(req, u, id));
export const DELETE = (_req: Request, c: Ctx) => guarded(c, (u, id) => remoteRideDelete(u, id));
