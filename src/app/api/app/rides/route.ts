import { getDb } from '@/db';
import { APP_HEADERS, appJson, withAppAuth } from '@/lib/app/http';
import { kmlFromKmz } from '@/lib/geo';
import { publicOrigin } from '@/lib/outings/export';
import { clientIp, rateLimit } from '@/lib/outings/rate-limit';
import { RIDE_MAX_BYTES } from '@/lib/outings/ride';
import { createSoloOutingFromRide } from '@/lib/outings/solo';

export const dynamic = 'force-dynamic';

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/** App recording ⇒ solo past outing with the GPX as ridden track (#1765). 201 created, 200 already received (same `clientId`). */
export const POST = withAppAuth(async (req, _c, auth) => {
  if (!rateLimit(`apprides:${auth.tokenId}`, 20, 60_000) || !rateLimit(`rideip:${clientIp(req)}`, 30, 60_000)) {
    return Response.json({ error: 'tooManyRequests' }, { status: 429, headers: { ...APP_HEADERS, 'Retry-After': '60' } });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) return appJson({ error: 'notGpx' }, 400);
  if (file.size > RIDE_MAX_BYTES) return appJson({ error: 'tooBig' }, 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  let xml: string;
  if (bytes.subarray(0, 2).toString('latin1') === 'PK') {
    try {
      xml = kmlFromKmz(bytes);
    } catch (e) {
      return e instanceof Error && e.message === 'tooBig' ? appJson({ error: 'tooBig' }, 413) : appJson({ error: 'notGpx' }, 400);
    }
  } else xml = bytes.toString('utf8');
  const res = await createSoloOutingFromRide(getDb().db, auth.userId, {
    xml, clientId: text(form.get('clientId')), title: text(form.get('title')), startedAt: text(form.get('startedAt')) || null,
  });
  if (!res.ok) return appJson({ error: res.error }, 400);
  return appJson({ slug: res.slug, url: `${publicOrigin(req)}/s/${res.slug}` }, res.created ? 201 : 200);
});
