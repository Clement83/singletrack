import { getDb } from '@/db';
import { clientIp, joinOpen, rateLimit } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Public. Open link of an outing (`[slug]` = open-link token): creates the person's personal invitation. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!rateLimit(`join:${clientIp(req)}`, 10, 60_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const res = joinOpen(getDb().db, (await params).slug, body?.name);
  if (res.ok) return Response.json({ path: `/i/${res.token}` }, { status: 201 });
  const status = { not_found: 404, disabled: 404, closed: 409, full: 409, invalid: 422, outingFrozen: 403 }[res.error];
  return Response.json({ error: res.error, errors: res.errors }, { status });
}
