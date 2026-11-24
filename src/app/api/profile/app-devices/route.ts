import QRCode from 'qrcode';
import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { publicOrigin } from '@/lib/federation/config';
import { createPairing, listDevices, revokeDevice } from '@/lib/app/tokens';
import { rateLimit } from '@/lib/outings/rate-limit';

export const dynamic = 'force-dynamic';

/** Private (session). Companion app devices (#1720): `GET` list, `POST` new pairing code + QR, `DELETE {id}` revokes a device. */
export async function GET() {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  return Response.json({ devices: listDevices(getDb().db, user.id) });
}

export async function POST() {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  if (!rateLimit(`apppaircode:${user.id}`, 10, 60_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
  const { code, expiresAt } = createPairing(getDb().db, user.id);
  // `singletrack://pair?...`: opens the companion app; the server is part of the link so the app works with any instance.
  const link = `singletrack://pair?server=${encodeURIComponent(publicOrigin())}&code=${code}`;
  const qr = await QRCode.toDataURL(link, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  return Response.json({ code, link, qr, expiresAt: expiresAt.toISOString() });
}

export async function DELETE(req: Request) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== 'string') return Response.json({ error: 'invalid' }, { status: 422 });
  return revokeDevice(getDb().db, user.id, body.id) ? Response.json({ ok: true }) : Response.json({ error: 'not_found' }, { status: 404 });
}
