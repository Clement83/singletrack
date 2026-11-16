import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from '@/db';
import { friendship, invitation, type InvitationRow, type OutingRow } from '@/db/schema';

/**
 * Source unique des droits sur une sortie (#1455, epic #1463). Toutes les routes et pages de sorties passent par ici
 * au lieu de tester « propriétaire seulement » chacune de leur côté.
 *
 * Modèle :
 * - **privée** (`visibility` = `friends` | `invite`) : un **propriétaire** (`owner_id`) seul modifie / annule ;
 *   `friends` = ses copains acceptés la voient et la rejoignent sans invitation, `invite` = seuls les invités la voient ;
 *   `participants_can_invite` laisse les participants inscrits inviter à leur tour ;
 * - **publique** (`visibility` = `public`, `owner_id` NULL) : pas de propriétaire, **tout est figé**, tout le monde a les mêmes droits.
 *   (Une ancienne sortie `public` encore pourvue d'un propriétaire, antérieure à #1455, reste modifiable par lui.)
 */
export type Viewer = {
  /** Compte connecté, s'il y en a un. */
  userId?: string | null;
  /** Invitation (lien perso) par laquelle le visiteur arrive, ligne déjà chargée par son token. */
  invitation?: Pick<InvitationRow, 'id' | 'userId' | 'status' | 'revokedAt'> | null;
};

export type OutingFacts = Pick<OutingRow, 'id' | 'ownerId' | 'createdBy' | 'visibility' | 'participantsCanInvite' | 'status' | 'startsAt'>;

export type OutingPermissions = {
  isOwner: boolean;
  /** Sans propriétaire : ni modification ni annulation possibles. */
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
  /** Révoquer cette invitation : le propriétaire toutes, tout autre seulement les liens qu'il a lui-même créés (#1457). */
  canRevoke: (inv: Pick<InvitationRow, 'createdByUserId' | 'createdByInvitationId'>) => boolean;
};

/** Sortie sans propriétaire = publique figée. */
export const isFrozen = (o: Pick<OutingRow, 'ownerId'>): boolean => o.ownerId == null;
export const isPublicOuting = (o: Pick<OutingRow, 'ownerId' | 'visibility'>): boolean => o.visibility === 'public' && o.ownerId == null;

/** Copains **locaux** : un copain d'un autre serveur n'a pas de session ici, il voit les sorties « copains » depuis son serveur (P6, #1476). */
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

  // Invitation du visiteur : celle de son lien, sinon celle rattachée à son compte (#1434 / #1444).
  let inv = viewer.invitation && !viewer.invitation.revokedAt ? viewer.invitation : null;
  if (!inv && uid) {
    inv = db.select({ id: invitation.id, userId: invitation.userId, status: invitation.status, revokedAt: invitation.revokedAt }).from(invitation)
      .where(and(eq(invitation.outingId, o.id), eq(invitation.userId, uid), isNull(invitation.revokedAt))).get() ?? null;
  }
  const hasInvitation = !!inv;
  const isParticipant = !!inv && inv.status === 'yes';
  const known = !!uid || hasInvitation; // un visiteur anonyme sans lien ne voit rien

  const friendOfOwner = !!uid && !!o.ownerId && uid !== o.ownerId && areFriendsOf(db, uid, o.ownerId);
  const canView = isOwner || hasInvitation || (isPublic && !!uid) || (o.visibility === 'friends' && friendOfOwner);

  // Inviter (lien perso, lien de groupe) : le propriétaire ; tout le monde en publique ; les participants si l'option est active.
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
