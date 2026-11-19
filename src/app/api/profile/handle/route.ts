import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { federationEnabled, fedAddress } from '@/lib/federation/config';
import { changeHandle, getHandle } from '@/lib/federation/handle';

export const dynamic = 'force-dynamic';

/** Private. My federated identifier (#1474): `GET` → `{handle, address, canChange}`; `PUT {handle}`: single change (400/409 with a code translated on the client). */
export async function GET() {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const { handle, canChange } = getHandle(getDb().db, user.id);
  return Response.json({ handle, address: handle && federationEnabled() ? fedAddress(handle) : null, canChange });
}

export async function PUT(req: Request) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const body = (await req.json().catch(() => null)) as { handle?: unknown } | null;
  const r = changeHandle(getDb().db, user.id, body?.handle);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.error === 'taken' || r.error === 'already_changed' || r.error === 'remote_friends' ? 409 : 400 });
  return Response.json({ handle: r.handle, address: federationEnabled() ? fedAddress(r.handle) : null, canChange: false });
}
