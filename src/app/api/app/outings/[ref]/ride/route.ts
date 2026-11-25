import { getDb } from '@/db';
import { withAppAuth } from '@/lib/app/http';
import { appOutingContext } from '@/lib/app/outings';
import { authenticateApp } from '@/lib/app/tokens';
import { isJoinedRemote, remoteRideDelete, remoteRideList, remoteRideUpload } from '@/lib/federation/rides-http';
import { rideHandlers } from '@/lib/outings/ride-http';

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
 * Shared with the web route (#1779): `src/lib/federation/rides-http.ts`.
 */
const isRemote = (userId: string, ref: string) => !appOutingContext(getDb().db, userId, ref) && isJoinedRemote(userId, ref);

export const GET = withAppAuth(async (req, c, auth) => {
  const ref = (await c.params).ref;
  return isRemote(auth.userId, ref) ? remoteRideList(auth.userId, ref) : h.list(req, c);
});

export const POST = withAppAuth(async (req, c, auth) => {
  const ref = (await c.params).ref;
  return isRemote(auth.userId, ref) ? remoteRideUpload(req, auth.userId, ref) : h.upload(req, c);
});

export const DELETE = withAppAuth(async (req, c, auth) => {
  const ref = (await c.params).ref;
  return isRemote(auth.userId, ref) ? remoteRideDelete(auth.userId, ref) : h.remove(req, c);
});
