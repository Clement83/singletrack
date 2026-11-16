import { getDb } from '@/db';
import { getInvitationByToken } from '@/lib/outings';
import { feedResponse, icsEvent, publicOrigin, requestLocale } from '@/lib/outings/export';

export const dynamic = 'force-dynamic';

/**
 * Abonnement agenda de l'invité (#1357) : `webcal://<hôte>/i/<token>/calendar.ics`. Une seule sortie ; l'agenda la
 * met à jour (UID stable, SEQUENCE) ou la barre (STATUS:CANCELLED). Lien révoqué ⇒ 404 : l'événement disparaît à la
 * prochaine synchro de l'agenda.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const found = getInvitationByToken(getDb().db, token);
  if (!found) return new Response('Not found', { status: 404 });
  const origin = publicOrigin(req);
  const ev = icsEvent(found.outing, requestLocale(req), `${origin}/i/${token}`, new URL(origin).host);
  return feedResponse([ev], found.outing.title);
}
