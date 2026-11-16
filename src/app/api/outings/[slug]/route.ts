import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { cancelOuting, makePublic, refreshSnapshot, regenerateSlug, setOpenLink, setStatus, updateOuting, type OutingInput, type Result } from '@/lib/outings';

export const dynamic = 'force-dynamic';

type Body = OutingInput & { action?: 'update' | 'cancel' | 'done' | 'restore' | 'refresh' | 'regenerate-slug' | 'open-link' | 'make-public'; enabled?: boolean };

/** Privé, réservé à l'organisateur (404 pour tout autre, sans distinguer « inconnue » de « pas à toi »). */
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== 'object') return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const { db } = getDb();
  const slug = (await params).slug;
  let res: Result<{ slug?: string }>;
  switch (body.action ?? 'update') {
    case 'update': res = updateOuting(db, user.id, slug, body); break;
    case 'cancel': res = cancelOuting(db, user.id, slug); break;
    case 'done': res = setStatus(db, user.id, slug, 'done'); break;
    case 'restore': res = setStatus(db, user.id, slug, 'planned'); break;
    case 'refresh': res = refreshSnapshot(db, user.id, slug); break;
    case 'regenerate-slug': res = regenerateSlug(db, user.id, slug); break;
    case 'make-public': res = makePublic(db, user.id, slug); break;
    case 'open-link': res = setOpenLink(db, user.id, slug, !!body.enabled); break;
    default: return Response.json({ error: 'unknownAction' }, { status: 400 });
  }
  if (res.ok) return Response.json(res);
  return Response.json({ error: res.error, errors: res.errors }, { status: res.error === 'not_found' ? 404 : res.error === 'outingFrozen' ? 403 : 422 });
}
