import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { inviteFriends, listInvitableFriends } from './friend-invites';
import { getInvitationByToken, getManagedOuting } from './service';
import { rateLimit } from './rate-limit';
import type { OutingRow } from '@/db/schema';

/** "Invite your friends" routes (#1458): from the organiser page (slug) or from the link of a participant linked to their account (token). */
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
/** Through the link: only the account linked to the invitation (or an account that has one on the outing) acts; rights come from `outingPermissions`. */
export const byToken = (_userId: string, token: string) => getInvitationByToken(getDb().db, token)?.outing;
