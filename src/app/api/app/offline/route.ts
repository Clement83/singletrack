import { getDb } from '@/db';
import { appJson, withAppAuth } from '@/lib/app/http';
import { offlineCatalog, throttled } from '@/lib/offline/serve';

export const dynamic = 'force-dynamic';

/** Offline catalogue (#1739): active regions with their PMTiles size and BRouter segments. Account token required. */
export const GET = withAppAuth(async (req, _c, auth) => {
  const { db } = getDb();
  return throttled(db, auth) ?? appJson(await offlineCatalog(db, new URL(req.url).origin));
});
