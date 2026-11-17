import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { getDefaultOutingVisibility, getVisibility, setDefaultOutingVisibility, setVisibility, isOutingVisibility, getDefaultTrackVisibility, setDefaultTrackVisibility, isTrackVisibility } from '@/lib/user-profile';

export const dynamic = 'force-dynamic';

/** Privé. Réglage de visibilité de mon profil (#1433) : `PUT {visibility?: 'private' | 'public', outingVisibility?: 'public' | 'friends' | 'invite'}` (#1442). */
export async function GET() {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const db = getDb().db;
  return Response.json({ visibility: getVisibility(db, user.id), outingVisibility: getDefaultOutingVisibility(db, user.id), drawnTrackVisibility: getDefaultTrackVisibility(db, user.id, 'drawn'), importedTrackVisibility: getDefaultTrackVisibility(db, user.id, 'imported') });
}

export async function PUT(req: Request) {
  let user;
  try { user = await assertUser(); } catch (e) { return unauthorized(e); }
  const body = (await req.json().catch(() => null)) as { visibility?: unknown; outingVisibility?: unknown; drawnTrackVisibility?: unknown; importedTrackVisibility?: unknown } | null;
  if (!body || (body.visibility === undefined && body.outingVisibility === undefined && body.drawnTrackVisibility === undefined && body.importedTrackVisibility === undefined)) return Response.json({ error: 'invalid' }, { status: 400 });
  const db = getDb().db;
  // Valider les deux avant d'écrire : pas de demi-enregistrement.
  const bad = (body.visibility !== undefined && body.visibility !== 'private' && body.visibility !== 'public')
    || (body.outingVisibility !== undefined && !isOutingVisibility(body.outingVisibility))
    || (body.drawnTrackVisibility !== undefined && !isTrackVisibility(body.drawnTrackVisibility))
    || (body.importedTrackVisibility !== undefined && !isTrackVisibility(body.importedTrackVisibility));
  if (bad) return Response.json({ error: 'invalid' }, { status: 400 });
  if (body.visibility !== undefined) setVisibility(db, user.id, body.visibility);
  if (body.outingVisibility !== undefined) setDefaultOutingVisibility(db, user.id, body.outingVisibility);
  if (body.drawnTrackVisibility !== undefined) setDefaultTrackVisibility(db, user.id, 'drawn', body.drawnTrackVisibility);
  if (body.importedTrackVisibility !== undefined) setDefaultTrackVisibility(db, user.id, 'imported', body.importedTrackVisibility);
  return Response.json({ visibility: getVisibility(db, user.id), outingVisibility: getDefaultOutingVisibility(db, user.id), drawnTrackVisibility: getDefaultTrackVisibility(db, user.id, 'drawn'), importedTrackVisibility: getDefaultTrackVisibility(db, user.id, 'imported') });
}
