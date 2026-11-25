import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { buildRemoteRecap } from '@/lib/federation/rides';
import { listMusic } from '@/lib/outings/music';
import { clientIp, rateLimit } from '@/lib/outings/rate-limit';

export const dynamic = 'force-dynamic';

/** Private (#1779): personal summary of a remote outing I joined, built from my own track kept here (no media from others). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  if (!rateLimit(`recapip:${clientIp(req)}`, 60, 60_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
  const recap = buildRemoteRecap(getDb().db, user.id, (await params).id);
  if (!recap) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ ...recap, music: listMusic() }, { headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } });
}
