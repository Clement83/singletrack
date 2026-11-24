import { getDb } from '@/db';
import { appNotFound, withAppAuth } from '@/lib/app/http';
import { segmentResponse, throttled } from '@/lib/offline/serve';

export const dynamic = 'force-dynamic';

/** BRouter segment `<name>.rd5` of an active region (Range for resuming, #1739). */
export const GET = withAppAuth(async (req, c, auth) => {
  const { name } = await c.params;
  const { db } = getDb();
  const limited = throttled(db, auth);
  if (limited) return limited;
  const m = /^(.+)\.rd5$/.exec(name);
  return (m && segmentResponse(db, auth, req, m[1])) || appNotFound();
});
