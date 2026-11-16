import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { claimInvitation } from '@/lib/friends';
import { rateLimit } from '@/lib/outings';

export const dynamic = 'force-dynamic';

// Rattachement de l'invité à son compte (#1434). Route sous /api/i (public pour le lien), mais le compte est exigé ici.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  if (!rateLimit(`claim:${user.id}`, 10, 60_000)) return Response.json({ error: 'rate_limited' }, { status: 429 });
  const r = claimInvitation(getDb().db, user.id, (await params).token);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.error === 'not_found' ? 404 : 409 });
  return Response.json({ ok: true });
}
