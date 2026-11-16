import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { respondRemote } from '@/lib/federation/outings';
import { rateLimit } from '@/lib/outings/rate-limit';

export const dynamic = 'force-dynamic';

/** Privé (#1476). `{ answer: 'yes' | 'maybe' | 'no' }` : ma réponse à une sortie d'un autre serveur ; l'organisateur confirme ensuite (Accept / Reject). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  if (!rateLimit(`remote-respond:${user.id}`, 30, 60_000)) return Response.json({ error: 'rate_limited' }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { answer?: unknown } | null;
  const r = await respondRemote(getDb().db, user.id, (await params).id, body?.answer);
  if (r.ok) return Response.json({ ok: true });
  return Response.json({ error: r.error }, { status: r.error === 'not_found' ? 404 : r.error === 'closed' ? 409 : 422 });
}
