import { getDb } from '@/db';
import { getInvitationByToken } from '@/lib/outings';
import { gpxResponse } from '@/lib/outings/export';

export const dynamic = 'force-dynamic';

/** Public (guest's personal link, #1351): GPX of the track frozen in the outing. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const found = getInvitationByToken(getDb().db, (await params).token);
  if (!found) return new Response('Not found', { status: 404 });
  return gpxResponse(found.outing);
}
