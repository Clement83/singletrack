import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { contact, invitation, remoteActor, user, type OutingRow } from '@/db/schema';
import { listFriends, remoteFriendActorIds } from '@/lib/friends';
import { federationEnabled } from '@/lib/federation/config';
import { sendInBackground, sendMail, type Mailer } from '@/lib/mail';
import { friendInviteMail } from '@/lib/mail-templates';
import { formatOutingDate } from '@/lib/format';
import { isLocale, DEFAULT_LOCALE } from '@/i18n/config';
import { isClosed, type Result } from './service';
import { outingPermissions } from './permissions';
import { newInviteToken } from './tokens';
import { emitRemoteInvites } from './federation-hook';

/**
 * Inviter ses copains (comptes) depuis une sortie (#1458, epic #1463 P4). Le droit vient de `outingPermissions`
 * (`canInviteFriends` : propriétaire, participant inscrit si l'option est active, tout compte en publique).
 * L'invitation est liée au compte du copain (`invitation.user_id`) et à celui qui invite (`created_by_user_id`) :
 * elle apparaît dans « Mes sorties » du copain, réponse en attente. Un mail part en arrière-plan.
 */

/** Préfixe des identifiants de copains d'un autre serveur dans `userIds`. */
export const REMOTE_PREFIX = 'remote:';

export type InvitableFriend = { userId: string; name: string };

/** Copains acceptés de `userId` qui ne sont pas encore dans la sortie (invitation active) ni son propriétaire. [] sans le droit. */
export function listInvitableFriends(db: Db, userId: string, o: OutingRow): InvitableFriend[] {
  if (!outingPermissions(db, { userId }, o).canInviteFriends) return [];
  const taken = new Set(
    db.select({ u: invitation.userId }).from(invitation).where(and(eq(invitation.outingId, o.id), isNull(invitation.revokedAt))).all().map((r) => r.u),
  );
  // Copains d'un autre serveur (#1476) : identifiant `remote:<id d'acteur>`, invités par ActivityPub (aucun lien, aucun mail d'ici).
  const takenRemote = new Set(
    db.select({ r: invitation.remoteActorId }).from(invitation).where(and(eq(invitation.outingId, o.id), isNull(invitation.revokedAt))).all().map((r) => r.r),
  );
  return listFriends(db, userId).friends.flatMap((f) => {
    if (f.remote) return federationEnabled() && !takenRemote.has(f.remote.actorId) ? [{ userId: `${REMOTE_PREFIX}${f.remote.actorId}`, name: `${f.name} · ${f.remote.domain}` }] : [];
    return f.userId && f.userId !== o.ownerId && f.userId !== o.createdBy && !taken.has(f.userId) ? [{ userId: f.userId, name: f.name }] : [];
  });
}


/** Invite des copains distants (ids d'acteurs) : une invitation par copain (réponse en attente), l'`Event` part à leur serveur. */
export function addRemoteInvites(db: Db, userId: string, o: OutingRow, remoteActorIds: string[]): { invited: string[]; skipped: string[]; actorIds: string[] } {
  const mine = new Set(remoteFriendActorIds(db, userId));
  const invited: string[] = [], skipped: string[] = [], actorIds: string[] = [];
  for (const id of new Set(remoteActorIds)) {
    const a = mine.has(id) ? db.select().from(remoteActor).where(eq(remoteActor.id, id)).get() : undefined;
    if (!a) continue; // pas un copain distant accepté : ignoré en silence
    const name = (a.displayName || a.handle).slice(0, 60);
    const existing = db.select().from(invitation).where(and(eq(invitation.outingId, o.id), eq(invitation.remoteActorId, id), isNull(invitation.revokedAt))).get();
    if (existing) { skipped.push(name); continue; }
    const { tokenHash } = newInviteToken(); // le jeton n'existe pas pour un distant : la colonne est unique et non nulle, il est jeté
    db.insert(invitation).values({ outingId: o.id, tokenHash, tokenEnc: null, remoteActorId: id, name, origin: 'remote', createdByUserId: userId }).run();
    invited.push(name);
    actorIds.push(id);
  }
  return { invited, skipped, actorIds };
}

export function inviteFriends(
  db: Db, userId: string, o: OutingRow, friendUserIds: unknown, mailer: Mailer = sendMail,
): Result<{ invited: string[]; skipped: string[] }> {
  if (!outingPermissions(db, { userId }, o).canInviteFriends) return { ok: false, error: 'not_found' };
  if (isClosed(o)) return { ok: false, error: 'closed' };
  const all = [...new Set(Array.isArray(friendUserIds) ? friendUserIds.filter((x): x is string => typeof x === 'string') : [])];
  if (!all.length || all.length > 100) return { ok: false, error: 'invalid', errors: { friends: 'friends' } };
  const ids = all.filter((x) => !x.startsWith(REMOTE_PREFIX));
  const remoteIds = federationEnabled() ? all.filter((x) => x.startsWith(REMOTE_PREFIX)).map((x) => x.slice(REMOTE_PREFIX.length)) : [];

  const allowed = new Map(listFriends(db, userId).friends.flatMap((f) => (f.userId ? [[f.userId, f.name] as const] : [])));
  const inviter = db.select({ name: user.name }).from(user).where(eq(user.id, userId)).get();
  const mails: { to: string; locale: string | null; token: string; name: string }[] = [];

  const out = db.transaction((tx) => {
    const taken = new Set(
      tx.select({ u: invitation.userId }).from(invitation).where(and(eq(invitation.outingId, o.id), isNull(invitation.revokedAt))).all().map((r) => r.u),
    );
    const targets = ids.filter((id) => allowed.has(id) && id !== o.ownerId && id !== o.createdBy);
    const users = targets.length ? tx.select({ id: user.id, email: user.email, locale: user.locale }).from(user).where(inArray(user.id, targets)).all() : [];
    // Pote du carnet de l'invitant déjà lié à ce copain : on garde le lien (historique, « Réinviter »).
    const contacts = new Map(
      tx.select({ id: contact.id, userId: contact.userId }).from(contact).where(and(eq(contact.ownerUserId, userId), eq(contact.archived, false))).all()
        .flatMap((c) => (c.userId ? [[c.userId, c.id] as const] : [])),
    );
    const invited: string[] = [];
    const skipped: string[] = [];
    const now = new Date();
    for (const id of ids) {
      const name = allowed.get(id);
      const u = users.find((x) => x.id === id);
      if (!name || !u) continue; // pas un copain accepté : ignoré en silence (pas d'annuaire)
      if (taken.has(id)) { skipped.push(name); continue; }
      const { token, tokenHash, tokenEnc } = newInviteToken();
      const contactId = contacts.get(id) ?? null;
      tx.insert(invitation).values({ outingId: o.id, tokenHash, tokenEnc, userId: id, name, contactId, origin: 'personal', createdByUserId: userId }).run();
      if (contactId) tx.update(contact).set({ lastInvitedAt: now }).where(eq(contact.id, contactId)).run();
      taken.add(id);
      invited.push(name);
      mails.push({ to: u.email, locale: u.locale ?? null, token, name });
    }
    return { invited, skipped };
  });

  const remote = remoteIds.length ? addRemoteInvites(db, userId, o, remoteIds) : { invited: [], skipped: [], actorIds: [] };
  if (remote.actorIds.length) emitRemoteInvites(db, o.id, remote.actorIds);
  out.invited.push(...remote.invited);
  out.skipped.push(...remote.skipped);

  const base = (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '');
  for (const m of mails) {
    const locale = isLocale(m.locale) ? m.locale : DEFAULT_LOCALE;
    sendInBackground(mailer, friendInviteMail(m.to, {
      inviter: inviter?.name ?? '', title: o.title, date: formatOutingDate(o.startsAt, locale), url: `${base}/i/${m.token}`,
    }, locale));
  }
  return { ok: true, ...out };
}
