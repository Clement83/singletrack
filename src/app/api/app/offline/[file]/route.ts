import { getDb } from '@/db';
import { appNotFound, withAppAuth } from '@/lib/app/http';
import { REGION_ID_RE } from '@/lib/offline/regions';
import { offlineStyle, pmtilesResponse, throttled } from '@/lib/offline/serve';
import { packsEnabled } from '@/lib/offline/store';

export const dynamic = 'force-dynamic';

/** `<region>.pmtiles` (Range, 206) and `style.json` (#1739). Anything not served ⇒ 404. */
export const GET = withAppAuth(async (req, c, auth) => {
  const { file } = await c.params;
  const { db } = getDb();
  const limited = throttled(db, auth);
  if (limited) return limited;
  if (file === 'style.json') {
    if (!packsEnabled(db)) return appNotFound();
    const region = new URL(req.url).searchParams.get('region') ?? '{region}';
    const url = `${new URL(req.url).origin}/api/app/offline/${region === '{region}' || REGION_ID_RE.test(region) ? region : '{region}'}.pmtiles`;
    return Response.json(offlineStyle(url), { headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } });
  }
  const m = /^([a-z0-9][a-z0-9-]{0,39})\.pmtiles$/.exec(file);
  return (m && pmtilesResponse(db, auth, req, m[1])) || appNotFound();
});
