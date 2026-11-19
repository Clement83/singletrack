import { getDb } from '@/db';
import { clientIp, rateLimit, respond } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/**
 * Public, no account. The link's token designates ONE invitation: only that one can be changed.
 * Unknown or revoked → generic 404. Rate-limited per IP.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!rateLimit(`resp:${clientIp(req)}`, 30, 60_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const res = respond(getDb().db, (await params).token, { status: body.status, name: body.name, comment: body.comment });
  if (res.ok) return Response.json({ ok: true });
  const status = { not_found: 404, closed: 409, full: 409, invalid: 422, disabled: 404, outingFrozen: 403 }[res.error];
  return Response.json({ error: res.error, errors: res.errors }, { status });
}
