import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { reportRemoteOuting } from '@/lib/federation/outings';
import { rateLimit } from '@/lib/outings/rate-limit';

export const dynamic = 'force-dynamic';

/** Privé (#1477). `{ reason?: string }` : signaler une sortie d'un autre serveur (copie pour l'admin local + `Flag` au serveur d'origine). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  if (!rateLimit(`remote-report:${user.id}`, 10, 3600_000)) return Response.json({ error: 'rate_limited' }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { reason?: unknown } | null;
  const r = await reportRemoteOuting(getDb().db, user.id, (await params).id, body?.reason);
  if (r.ok) return Response.json({ ok: true });
  return Response.json({ error: r.error }, { status: r.error === 'not_found' ? 404 : 422 });
}
