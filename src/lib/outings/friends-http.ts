import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { inviteFriends, listInvitableFriends } from './friend-invites';
import { getInvitationByToken, getManagedOuting } from './service';
import { rateLimit } from './rate-limit';
import type { OutingRow } from '@/db/schema';

/** Routes « inviter ses copains » (#1458) : par la page organisateur (slug) ou par le lien d'un participant rattaché à son compte (token). */
export function friendsHandlers(resolve: (userId: string, key: string) => OutingRow | undefined) {
  return {
    async GET(_req: Request, key: string) {
      let user;
      try { user = await assertUser(); } catch (e) { return unauthorized(e); }
      const o = resolve(user.id, key);
      if (!o) return Response.json({ error: 'not_found' }, { status: 404 });
      return Response.json({ friends: listInvitableFriends(getDb().db, user.id, o) });
    },
    async POST(req: Request, key: string) {
      let user;
      try { user = await assertUser(); } catch (e) { return unauthorized(e); }
      if (!rateLimit(`friends:${user.id}`, 20, 60_000)) return Response.json({ error: 'rate_limited' }, { status: 429 });
      const o = resolve(user.id, key);
      if (!o) return Response.json({ error: 'not_found' }, { status: 404 });
      const body = (await req.json().catch(() => null)) as { userIds?: unknown } | null;
      const r = inviteFriends(getDb().db, user.id, o, body?.userIds);
      if (r.ok) return Response.json({ invited: r.invited, skipped: r.skipped }, { status: 201 });
      return Response.json({ error: r.error, errors: r.errors }, { status: r.error === 'not_found' ? 404 : r.error === 'closed' ? 409 : 422 });
    },
  };
}

export const bySlug = (userId: string, slug: string) => getManagedOuting(getDb().db, userId, slug);
/** Par le lien : seul le compte rattaché à l'invitation (ou un compte qui en a une sur la sortie) agit ; les droits viennent de `outingPermissions`. */
export const byToken = (_userId: string, token: string) => getInvitationByToken(getDb().db, token)?.outing;
