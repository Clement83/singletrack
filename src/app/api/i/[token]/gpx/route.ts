import { getDb } from '@/db';
import { getInvitationByToken } from '@/lib/outings';
import { gpxResponse } from '@/lib/outings/export';

export const dynamic = 'force-dynamic';

/** Public (lien perso de l'invité, #1351) : GPX de la trace figée dans la sortie. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const found = getInvitationByToken(getDb().db, (await params).token);
  if (!found) return new Response('Not found', { status: 404 });
  return gpxResponse(found.outing);
}
