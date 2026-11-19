import { getDb } from '@/db';
import { getInvitationByToken } from '@/lib/outings';
import { icsResponse, publicOrigin, requestLocale } from '@/lib/outings/export';

export const dynamic = 'force-dynamic';

/** Public (guest's personal link, #1351): the outing as .ics. The event's link brings back to the guest's page. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const found = getInvitationByToken(getDb().db, token);
  if (!found) return new Response('Not found', { status: 404 });
  const origin = publicOrigin(req);
  return icsResponse(found.outing, requestLocale(req), `${origin}/i/${token}`, new URL(origin).host);
}
