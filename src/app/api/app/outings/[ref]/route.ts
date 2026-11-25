import { getDb } from '@/db';
import { appJson, appNotFound, withAppAuth } from '@/lib/app/http';
import { appOutingContext, appOutingDetail } from '@/lib/app/outings';
import { appRemoteDetail, appRemoteOuting } from '@/lib/app/remote-outings';

export const dynamic = 'force-dynamic';

/**
 * Outing as JSON, same rights as `/s/<slug>` (`ref` = slug) or as a linked guest (`ref` = outing id). Invisible ⇒ 404 (#1720).
 * An outing from another server I joined is designated by its local copy's id (#1775).
 */
export const GET = withAppAuth(async (_req, c, auth) => {
  const { db } = getDb();
  const ref = (await c.params).ref;
  const ctx = appOutingContext(db, auth.userId, ref);
  if (ctx) return appJson(appOutingDetail(db, ctx));
  const remote = appRemoteOuting(db, auth.userId, ref);
  return remote ? appJson(appRemoteDetail(remote)) : appNotFound();
});
