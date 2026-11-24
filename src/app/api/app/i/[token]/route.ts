import { getDb } from '@/db';
import { appJson, appNotFound } from '@/lib/app/http';
import { appGuestContext, appOutingDetail } from '@/lib/app/outings';
import { clientIp, rateLimit } from '@/lib/outings/rate-limit';

export const dynamic = 'force-dynamic';

/** Public, no account: same data and rights as `/i/<token>` (the personal link designates one invitation). Revoked or unknown ⇒ 404 (#1720). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!rateLimit(`appguest:${clientIp(req)}`, 60, 60_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429, headers: { 'Retry-After': '60' } });
  const { db } = getDb();
  const ctx = appGuestContext(db, (await params).token);
  return ctx ? appJson(appOutingDetail(db, ctx)) : appNotFound();
}
