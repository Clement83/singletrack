import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outing, user } from '@/db/schema';
import type { Participant } from './participants-summary';

export * from './participants-summary';

const ORDER = { yes: 0, maybe: 1, pending: 2, no: 3 } as const;

/**
 * Participants d'une sortie pour le bloc « Qui vient » (#1468) : prénoms seulement, invitations révoquées exclues.
 * Ordre : « Toi » d'abord, puis l'organisateur, puis l'ordre de réponse (les sans-réponse à la fin, par création).
 * Le droit de voir est celui de la page appelante (lien invité valide ou gestionnaire connecté).
 */
export function listParticipants(db: Db, outingId: string, viewer: { invitationId?: string; userId?: string }): Participant[] {
  const o = db.select({ ownerId: outing.ownerId }).from(outing).where(eq(outing.id, outingId)).get();
  const rows = db
    .select({ id: invitation.id, name: invitation.name, status: invitation.status, userId: invitation.userId, respondedAt: invitation.respondedAt, createdAt: invitation.createdAt })
    .from(invitation)
    .where(and(eq(invitation.outingId, outingId), isNull(invitation.revokedAt)))
    .orderBy(asc(invitation.createdAt))
    .all();
  const ownerName = o?.ownerId ? db.select({ name: user.name }).from(user).where(eq(user.id, o.ownerId)).get()?.name : undefined;
  const isOwnerRow = (r: (typeof rows)[number]) => !!o?.ownerId && r.userId === o.ownerId;
  const key = (r: (typeof rows)[number]) => (r.respondedAt ?? r.createdAt).getTime();
  const list: (Participant & { sort: number })[] = rows
    .filter((r) => !isOwnerRow(r))
    .map((r) => ({
      id: r.id, name: r.name, status: r.status, isMe: r.id === viewer.invitationId, isOrganizer: false,
      sort: ORDER[r.status] * 1e15 + key(r),
    }));
  if (o?.ownerId && ownerName) {
    list.push({ id: `owner-${o.ownerId}`, name: ownerName, status: 'yes', isMe: viewer.userId === o.ownerId, isOrganizer: true, sort: -1 });
  }
  const rank = (p: Participant) => (p.isMe ? 0 : p.isOrganizer ? 1 : 2);
  return list
    .sort((a, b) => rank(a) - rank(b) || a.sort - b.sort)
    .map((p) => ({ id: p.id, name: p.name, status: p.status, isMe: p.isMe, isOrganizer: p.isOrganizer }));
}
