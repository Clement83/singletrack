import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { getManagedOuting } from '@/lib/outings';
import { icsResponse, publicOrigin, requestLocale } from '@/lib/outings/export';

export const dynamic = 'force-dynamic';

/** Private, organiser only (#1351): the outing as .ics, with the link to its organiser page. */
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
