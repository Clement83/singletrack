import { getDb } from '@/db';
import { getInvitationByToken } from '@/lib/outings';
import { feedResponse, icsEvent, publicOrigin, requestLocale } from '@/lib/outings/export';

export const dynamic = 'force-dynamic';

/**
 * Guest's calendar subscription (#1357): `webcal://<host>/i/<token>/calendar.ics`. A single outing; the calendar
 * updates it (stable UID, SEQUENCE) or strikes it out (STATUS:CANCELLED). Revoked link ⇒ 404: the event disappears at the
 * calendar's next sync.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const found = getInvitationByToken(getDb().db, token);
  if (!found) return new Response('Not found', { status: 404 });
  const origin = publicOrigin(req);
  const ev = icsEvent(found.outing, requestLocale(req), `${origin}/i/${token}`, new URL(origin).host);
  return feedResponse([ev], found.outing.title);
}
