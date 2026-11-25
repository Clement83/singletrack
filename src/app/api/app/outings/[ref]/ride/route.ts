import { getDb } from '@/db';
import { appJson, withAppAuth } from '@/lib/app/http';
import { appOutingContext } from '@/lib/app/outings';
import { authenticateApp } from '@/lib/app/tokens';
import { deleteRemoteRide, joinedRemoteOuting, listMyRemoteRide, saveRemoteRide } from '@/lib/federation/rides';
import { analyzeRide, RIDE_MAX_BYTES } from '@/lib/outings/ride';
import { readRideUpload, rideHandlers } from '@/lib/outings/ride-http';
import { clientIp, rateLimit } from '@/lib/outings/rate-limit';

export const dynamic = 'force-dynamic';

// Ridden track upload with an app token (#1720): same handler, limits and rights as `/api/outings/<slug>/ride` and `/api/i/<token>/ride`.
const h = rideHandlers(
  async (req, p) => {
    const { db } = getDb();
    const auth = authenticateApp(db, req);
    return auth ? appOutingContext(db, auth.userId, p.ref) : undefined;
  },
  (_r, p) => `app:${p.ref}`,
);

/**
 * Outing from another server I joined (#1775): `ref` = id of its local copy. My track is kept here (whole) and sent to the organiser's
 * server when it announces the feature; the answer says what happened (`federated`: `sent` | `unsupported` | `off` | `tooShort`).
 */
const STATUS = { not_found: 404, closed: 409, tooEarly: 409 } as const;
type Auth = { userId: string };
const remote = (auth: Auth, ref: string) => joinedRemoteOuting(getDb().db, auth.userId, ref);
const limited = (req: Request, ref: string) => !rateLimit(`ride:app:${ref}`, 10, 60_000) || !rateLimit(`rideip:${clientIp(req)}`, 30, 60_000);

export const GET = withAppAuth(async (req, c, auth) => {
  const ref = (await c.params).ref;
  if (appOutingContext(getDb().db, auth.userId, ref) || !remote(auth, ref)) return h.list(req, c);
  return appJson({ rides: listMyRemoteRide(getDb().db, auth.userId, ref) });
});

export const POST = withAppAuth(async (req, c, auth) => {
  const ref = (await c.params).ref;
  if (appOutingContext(getDb().db, auth.userId, ref) || !remote(auth, ref)) return h.upload(req, c);
  if (limited(req, ref)) return appJson({ error: 'tooManyRequests' }, 429);
  const xml = await readRideUpload(req);
  if (xml instanceof Response) return xml;
  if (xml.length > RIDE_MAX_BYTES) return appJson({ error: 'tooLarge' }, 413);
  let stats;
  try {
    stats = await analyzeRide(xml);
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    return appJson({ error: code === 'doctype' || code === 'noTrack' ? code : 'notGpx' }, 422);
  }
  const res = await saveRemoteRide(getDb().db, auth.userId, ref, stats);
  return res.ok ? appJson({ ok: true, id: res.id, federated: res.federated }, 201) : appJson({ error: res.error }, STATUS[res.error]);
});

export const DELETE = withAppAuth(async (req, c, auth) => {
  const ref = (await c.params).ref;
  if (appOutingContext(getDb().db, auth.userId, ref) || !remote(auth, ref)) return h.remove(req, c);
  if (!rateLimit(`ride:app:${ref}`, 10, 60_000)) return appJson({ error: 'tooManyRequests' }, 429);
  await deleteRemoteRide(getDb().db, auth.userId, ref);
  return appJson({ ok: true });
});
