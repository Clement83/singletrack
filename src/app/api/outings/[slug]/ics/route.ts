import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { getManagedOuting } from '@/lib/outings';
import { icsResponse, publicOrigin, requestLocale } from '@/lib/outings/export';

export const dynamic = 'force-dynamic';

/** Privé, organisateur seulement (#1351) : la sortie en .ics, avec le lien de sa page organisateur. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const o = getManagedOuting(getDb().db, user.id, (await params).slug);
  if (!o) return new Response('Not found', { status: 404 });
  const origin = publicOrigin(req);
  return icsResponse(o, requestLocale(req), `${origin}/s/${o.slug}`, new URL(origin).host);
}
