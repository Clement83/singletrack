import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { regenerateCalendarFeedToken } from '@/lib/outings';

export const dynamic = 'force-dynamic';

/** Private (#1357): new token for the organiser's calendar feed; the old link answers 404. */
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
