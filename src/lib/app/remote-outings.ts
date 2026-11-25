import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { remoteResponse } from '@/db/schema';
import { profileFor } from '@/lib/outings/profile';
import { isDone } from '@/lib/outings/history';
import { listRemoteOutings, type RemoteOutingView } from '@/lib/federation/outings';

/**
 * Outings from other servers in the companion app (#1775): an account that joined one ("yes" / "maybe", not refused) sees it in
 * `GET /api/app/outings` like a local outing (role `guest`, plus `remote`), so the app can send its ridden track through the same
 * `…/<id>/ride` routes. Read-only, built from the cached copy; never the organiser's other guests.
 */
const RECENT_MS = 30 * 86_400_000;

const joined = (v: RemoteOutingView) => (v.answer === 'yes' || v.answer === 'maybe') && v.state !== 'rejected';

function summary(v: RemoteOutingView, now: Date) {
  return {
    id: v.id,
    role: 'guest' as const,
    remote: { domain: v.organizer.domain },
    title: v.title,
    startsAt: v.startsAt.toISOString(),
    status: v.status,
    cancelled: v.status === 'cancelled',
    done: isDone(v, now),
    closed: v.closed,
    meeting: { lat: v.lat, lon: v.lon, label: v.label },
    distanceM: v.track?.distanceM ?? 0,
    elevationGainM: v.track?.elevationGainM ?? null,
    level: v.level,
    ebike: v.ebike,
    organizerName: v.organizer.name,
  };
}

export type AppRemoteSummary = ReturnType<typeof summary>;

/** Remote outings joined by the account, upcoming and the last 30 days (`listRemoteOutings` alone hides past ones: read by id). */
export function listAppRemoteOutings(db: Db, userId: string, now = new Date()): AppRemoteSummary[] {
  const since = now.getTime() - RECENT_MS;
  const ids = db.select({ id: remoteResponse.remoteOutingId }).from(remoteResponse).where(eq(remoteResponse.userId, userId)).all().map((r) => r.id);
  return ids.flatMap((id) => listRemoteOutings(db, userId, { id, now }))
    .filter((v) => joined(v) && v.startsAt.getTime() >= since)
    .map((v) => summary(v, now));
}

/** One joined remote outing, or undefined (404). */
export function appRemoteOuting(db: Db, userId: string, id: string, now = new Date()): RemoteOutingView | undefined {
  const v = listRemoteOutings(db, userId, { id, now })[0];
  return v && joined(v) ? v : undefined;
}

/** Detail in the shape of `appOutingDetail` (participants unknown here: only the "I'm in" count of the copy). */
export function appRemoteDetail(v: RemoteOutingView, now = new Date()) {
  const t = v.track;
  return {
    ...summary(v, now),
    description: v.description,
    maxParticipants: v.maxParticipants,
    visibility: v.visibility,
    webPath: `/sorties/distante/${v.id}`,
    myAnswer: v.answer,
    yesCount: v.yesCount,
    participants: [],
    track: t ? {
      name: t.name, geometry: t.geometry, bbox: t.bbox, start: t.start, distanceM: t.distanceM,
      elevationGainM: t.elevationGainM, elevationLossM: t.elevationLossM, minEle: t.minEle, maxEle: t.maxEle,
      difficulty: t.difficulty, loop: t.loop, attribution: t.attribution, license: t.license,
      profile: profileFor(t.geometry),
    } : null,
  };
}
