import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { addDays, getDayRecord, getLevels, getMassifs, inSeason, isDateStr, massifLabel, parisDate } from '@/lib/fire';

export const dynamic = 'force-dynamic';

/**
 * Private ("Fire" layer of the map). `GET /api/massifs?date=YYYY-MM-DD` (default: today):
 * GeoJSON of the massifs with `level` (1 green … 5 black, 0 = unknown). `status` says why a level is missing.
 * Database read only: no call to the prefecture from a request.
 */
export async function GET(req: Request) {
  try {
    await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const { db } = getDb();
  const now = new Date();
  const q = new URL(req.url).searchParams.get('date');
  const today = parisDate(now);
  const date = isDateStr(q) ? q : today;
  const rec = getDayRecord(db, date);
  const levels = rec?.status === 'ok' ? getLevels(db, date) : new Map();
  const status = rec?.status === 'ok' ? 'ok' : !inSeason(date) ? 'off_season' : date >= addDays(today, 1) && rec?.status !== 'error' ? 'pending' : 'unavailable';
  return Response.json({
    date,
    status,
    type: 'FeatureCollection',
    features: getMassifs(db).map((m) => ({
      type: 'Feature',
      id: m.code,
      geometry: m.geometry,
      properties: { code: m.code, name: massifLabel(m.name), level: levels.get(m.code)?.level ?? 0 },
    })),
  });
}
