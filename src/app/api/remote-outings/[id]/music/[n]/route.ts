import { assertUser, unauthorized } from '@/lib/current-user';
import { isJoinedRemote } from '@/lib/federation/rides-http';
import { musicHandler } from '@/lib/outings/recap-http';

export const dynamic = 'force-dynamic';

// Private (#1779): background music of the summary export, same rights as the remote recap (the resolver only has to be truthy).
const h = musicHandler(async (_r, p) => (isJoinedRemote((await assertUser()).id, p.id) ? ({} as never) : undefined));
export const GET = async (req: Request, c: { params: Promise<Record<string, string>> }) => {
  try { return await h(req, c); } catch (e) { return unauthorized(e); }
};
