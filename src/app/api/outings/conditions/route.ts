import { canViewTrack } from '@/lib/tracks/query';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { track } from '@/db/schema';
import { previewConditions } from '@/lib/conditions-preview';
import { assertUser, unauthorized } from '@/lib/current-user';
import { getManagedOuting, parisToUtc } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/**
 * Privé. `GET /api/outings/conditions?trace=<slug>|outing=<slug>&date=&time=&lat=&lon=` (#1407) :
 * verdict des conditions pendant qu'on organise une sortie (création ou modification). 422 tant que
 * date/heure/RDV ne sont pas valides ; une source manquante ne bloque jamais.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const sp = new URL(req.url).searchParams;
  const startsAt = parisToUtc(sp.get('date') ?? '', sp.get('time') ?? '');
  const lat = Number(sp.get('lat'));
  const lon = Number(sp.get('lon'));
  if (!startsAt || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return Response.json({ error: 'invalid' }, { status: 422 });
  const { db } = getDb();
  const outingSlug = sp.get('outing');
  const traceSlug = sp.get('trace');
  let base;
  if (outingSlug) {
    const o = getManagedOuting(db, user.id, outingSlug);
    if (o) base = { geometry: o.trackSnapshot.geometry, distanceM: o.trackSnapshot.distanceM, gainM: o.trackSnapshot.elevationGainM };
  } else if (traceSlug) {
    const t = db.select().from(track).where(eq(track.slug, traceSlug)).get();
    if (t && t.status !== 'draft' && canViewTrack(db, t, user.id)) base = { geometry: t.geometry, distanceM: t.distanceM, gainM: t.elevationGainM };
  }
  if (!base) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json(await previewConditions(db, { ...base, startsAt, lat, lon }));
}
