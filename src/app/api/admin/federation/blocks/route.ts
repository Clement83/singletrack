import { getDb } from '@/db';
import { adminDenied, assertAdmin } from '@/lib/admin';
import { blockDomain, importBlockList, unblockDomain } from '@/lib/federation/moderation';

export const dynamic = 'force-dynamic';

/**
 * Admin (#1477). `{ domain, reason? }` blocks a server; `{ csv }` imports a shared list (Mastodon format, `suspend` lines).
 * Blocking immediately removes friends, cached outings and invitations coming from that server.
 */
export async function POST(req: Request) {
  try { await assertAdmin(); } catch (e) { return adminDenied(e); }
  const body = (await req.json().catch(() => null)) as { domain?: unknown; reason?: unknown; csv?: unknown } | null;
  const { db } = getDb();
  if (typeof body?.csv === 'string') {
    if (body.csv.length > 2_000_000) return Response.json({ error: 'invalid' }, { status: 422 });
    return Response.json({ ok: true, ...importBlockList(db, body.csv) });
  }
  const domain = blockDomain(db, body?.domain, typeof body?.reason === 'string' ? body.reason : null);
  return domain ? Response.json({ ok: true, domain }) : Response.json({ error: 'invalidDomain' }, { status: 422 });
}

/** Admin. `{ domain }`: unblocks a server. */
export async function DELETE(req: Request) {
  try { await assertAdmin(); } catch (e) { return adminDenied(e); }
  const body = (await req.json().catch(() => null)) as { domain?: unknown } | null;
  return unblockDomain(getDb().db, body?.domain) ? Response.json({ ok: true }) : Response.json({ error: 'not_found' }, { status: 404 });
}
