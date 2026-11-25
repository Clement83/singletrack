import { getDb } from '@/db';
import { appJson } from '@/lib/app/http';
import { analyzeRide, RIDE_MAX_BYTES } from '@/lib/outings/ride';
import { readRideUpload } from '@/lib/outings/ride-http';
import { clientIp, rateLimit } from '@/lib/outings/rate-limit';
import { deleteRemoteRide, joinedRemoteOuting, listMyRemoteRide, saveRemoteRide } from './rides';

/**
 * GET / POST (multipart `file`) / DELETE of my ridden track on a remote outing I joined (#1775, #1779). Shared by the companion-app
 * route (Bearer, `appJson`) and the web route (session): the caller has authenticated and passes the user id.
 */
const STATUS = { not_found: 404, closed: 409, tooEarly: 409 } as const;
const limited = (req: Request, ref: string) => !rateLimit(`ride:app:${ref}`, 10, 60_000) || !rateLimit(`rideip:${clientIp(req)}`, 30, 60_000);

export const isJoinedRemote = (userId: string, ref: string) => !!joinedRemoteOuting(getDb().db, userId, ref);

export const remoteRideList = (userId: string, ref: string) => appJson({ rides: listMyRemoteRide(getDb().db, userId, ref) });

export async function remoteRideUpload(req: Request, userId: string, ref: string) {
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
  const res = await saveRemoteRide(getDb().db, userId, ref, stats);
  return res.ok ? appJson({ ok: true, id: res.id, federated: res.federated }, 201) : appJson({ error: res.error }, STATUS[res.error]);
}

export async function remoteRideDelete(userId: string, ref: string) {
  if (!rateLimit(`ride:app:${ref}`, 10, 60_000)) return appJson({ error: 'tooManyRequests' }, 429);
  await deleteRemoteRide(getDb().db, userId, ref);
  return appJson({ ok: true });
}
