import { getDb } from '@/db';
import { appJson } from '@/lib/app/http';
import { exchangePairing } from '@/lib/app/tokens';
import { clientIp, rateLimit } from '@/lib/outings/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Public (the code is the credential): exchanges a single-use pairing code (QR / typed, 5 min) for a long-lived app token (#1720).
 * Body `{ code, deviceName? }` → `{ token }`. Unknown, expired or replayed code ⇒ 401. Rate-limited per IP and globally.
 */
export async function POST(req: Request) {
  if (!rateLimit(`apppair:${clientIp(req)}`, 10, 60_000) || !rateLimit('apppair:all', 120, 60_000)) {
    return Response.json({ error: 'tooManyRequests' }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const body = (await req.json().catch(() => null)) as { code?: unknown; deviceName?: unknown } | null;
  const r = exchangePairing(getDb().db, body?.code, body?.deviceName);
  return r.ok ? appJson({ token: r.token }) : appJson({ error: 'unauthorized' }, 401);
}
