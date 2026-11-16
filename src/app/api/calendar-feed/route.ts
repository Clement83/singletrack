import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { regenerateCalendarFeedToken } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Privé (#1357) : nouveau jeton du flux agenda de l'organisateur ; l'ancien lien répond 404. */
export async function POST() {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const token = regenerateCalendarFeedToken(getDb().db, user.id);
  return Response.json({ path: `/cal/${token}/calendar.ics` });
}
