import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from '@/db';
import { friendship, invitation, type InvitationRow, type OutingRow } from '@/db/schema';

/**
 * Single source of the rights on an outing (#1455, epic #1463). Every outing route and page goes through here
 * instead of each testing "owner only" on its own.
 *
 * Model:
 * - **private** (`visibility` = `friends` | `invite`): one **owner** (`owner_id`) alone edits / cancels;
 *   `friends` = their accepted friends see it and join without an invitation, `invite` = only guests see it;
 *   `participants_can_invite` lets registered participants invite in turn;
 * - **public** (`visibility` = `public`, `owner_id` NULL): no owner, **everything is frozen**, everyone has the same rights.
 *   (An old `public` outing that still has an owner, from before #1455, stays editable by them.)
 */
export type Viewer = {
  /** Signed-in account, if any. */
  userId?: string | null;
  /** Invitation (personal link) the visitor comes through, row already loaded from its token. */
  invitation?: Pick<InvitationRow, 'id' | 'userId' | 'status' | 'revokedAt'> | null;
};

export type OutingFacts = Pick<OutingRow, 'id' | 'ownerId' | 'createdBy' | 'visibility' | 'participantsCanInvite' | 'status' | 'startsAt'>;

export type OutingPermissions = {
  isOwner: boolean;
  /** Without an owner: neither editing nor cancelling is possible. */
  frozen: boolean;
  isPublic: boolean;
  isParticipant: boolean;
  canView: boolean;
  canEdit: boolean;
  canCancel: boolean;
  canInvite: boolean;
  canInviteFriends: boolean;
  canShareGroupLink: boolean;
  canModerateComment: boolean;
  canJoin: boolean;
  /** Revoke this invitation: the owner any of them, anyone else only the links they created themselves (#1457). */
  canRevoke: (inv: Pick<InvitationRow, 'createdByUserId' | 'createdByInvitationId'>) => boolean;
};

/** Outing without an owner = frozen public outing. */
export const isFrozen = (o: Pick<OutingRow, 'ownerId'>): boolean => o.ownerId == null;
export const isPublicOuting = (o: Pick<OutingRow, 'ownerId' | 'visibility'>): boolean => o.visibility === 'public' && o.ownerId == null;

/** **Local** friends: a friend on another server has no session here, they see "friends" outings from their server (P6, #1476). */
export function areFriendsOf(db: Db, a: string, b: string): boolean {
  return !!db.select({ id: friendship.id }).from(friendship)
    .where(and(eq(friendship.status, 'accepted'), or(
      and(eq(friendship.requesterId, a), eq(friendship.addresseeId, b)),
      and(eq(friendship.requesterId, b), eq(friendship.addresseeId, a)),
    ))).get();
}

const GRACE_MS = 6 * 3600_000;
const closed = (o: Pick<OutingRow, 'status' | 'startsAt'>, now: Date) => o.status !== 'planned' || o.startsAt.getTime() + GRACE_MS < now.getTime();

export function outingPermissions(db: Db, viewer: Viewer, o: OutingFacts, now = new Date()): OutingPermissions {
  const uid = viewer.userId ?? null;
  const isOwner = !!uid && o.ownerId === uid;
  const frozen = isFrozen(o);
  const isPublic = o.visibility === 'public';

  // Visitor's invitation: the one from their link, otherwise the one attached to their account (#1434 / #1444).
  let inv = viewer.invitation && !viewer.invitation.revokedAt ? viewer.invitation : null;
  if (!inv && uid) {
    inv = db.select({ id: invitation.id, userId: invitation.userId, status: invitation.status, revokedAt: invitation.revokedAt }).from(invitation)
      .where(and(eq(invitation.outingId, o.id), eq(invitation.userId, uid), isNull(invitation.revokedAt))).get() ?? null;
  }
  const hasInvitation = !!inv;
  const isParticipant = !!inv && inv.status === 'yes';
  const known = !!uid || hasInvitation; // an anonymous visitor without a link sees nothing

  const friendOfOwner = !!uid && !!o.ownerId && uid !== o.ownerId && areFriendsOf(db, uid, o.ownerId);
  const canView = isOwner || hasInvitation || (isPublic && !!uid) || (o.visibility === 'friends' && friendOfOwner);

  // Invite (personal link, group link): the owner; everyone for a public outing; participants if the option is on.
  const open = isOwner || (isPublic && known && canView) || (o.participantsCanInvite && isParticipant);
  const canInvite = open;
  const canInviteFriends = open && !!uid;

  return {
    isOwner, frozen, isPublic, isParticipant, canView,
    canEdit: isOwner && !frozen,
    canCancel: isOwner && !frozen,
    canInvite,
    canInviteFriends,
    canShareGroupLink: canInvite,
    canModerateComment: isOwner,
    canJoin: !!uid && !isOwner && canView && !closed(o, now),
    canRevoke: (i) => isOwner || (!!uid && i.createdByUserId === uid) || (!!inv && i.createdByInvitationId === inv.id),
  };
}
