import { getDb } from '@/db';
import { appJson, appNotFound, withAppAuth } from '@/lib/app/http';
import { appOutingContext, appOutingDetail } from '@/lib/app/outings';

export const dynamic = 'force-dynamic';

/** Outing as JSON, same rights as `/s/<slug>` (`ref` = slug) or as a linked guest (`ref` = outing id). Invisible ⇒ 404 (#1720). */
export const GET = withAppAuth(async (_req, c, auth) => {
  const { db } = getDb();
  const ctx = appOutingContext(db, auth.userId, (await c.params).ref);
  return ctx ? appJson(appOutingDetail(db, ctx)) : appNotFound();
});
