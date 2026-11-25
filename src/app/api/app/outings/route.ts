import { getDb } from '@/db';
import { appJson, withAppAuth } from '@/lib/app/http';
import { listAppOutings } from '@/lib/app/outings';
import { listAppRemoteOutings } from '@/lib/app/remote-outings';

export const dynamic = 'force-dynamic';

/** My outings (organiser or linked guest, #1720, plus outings from other servers I joined, #1775): upcoming and the last 30 days. */
export const GET = withAppAuth(async (_req, _c, auth) => {
  const { db } = getDb();
  const outings = [...listAppOutings(db, auth.userId), ...listAppRemoteOutings(db, auth.userId)].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return appJson({ outings });
});
