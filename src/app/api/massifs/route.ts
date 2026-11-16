import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { addDays, getDayRecord, getLevels, getMassifs, inSeason, isDateStr, massifLabel, parisDate } from '@/lib/fire';

export const dynamic = 'force-dynamic';

/**
 * Privé (couche « Incendie » de la carte). `GET /api/massifs?date=YYYY-MM-DD` (défaut : aujourd'hui) :
 * GeoJSON des massifs avec `level` (1 vert … 5 noir, 0 = inconnu). `status` dit pourquoi un niveau manque.
 * Lecture en base uniquement : aucun appel à la préfecture depuis une requête.
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
