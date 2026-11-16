import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outing, user, type OutingRow } from '@/db/schema';
import { outingPermissions } from './permissions';
import { utcToParisInputs } from './time';
import { countYes, isClosed } from './service';
import { decryptToken, newInviteToken } from './tokens';

/**
 * « Sorties ouvertes » (#1443, epic #1440) : sorties d'autres comptes que l'utilisateur peut découvrir
 * (`public`, ou `friends` + copain accepté), à venir, non annulées, pas encore rejointes par lui.
 * Résumé volontairement maigre : jamais de prénoms de participants, d'email, de token ni de slug organisateur.
 */
export type OpenOuting = {
  id: string;
  title: string;
  startsAt: Date;
  organizerName: string;
  meetingLabel: string | null;
  distanceM: number;
  gainM: number | null;
  level: OutingRow['level'];
  ebike: OutingRow['ebike'];
  visibility: 'public' | 'friends';
  yesCount: number;
  /** `null` = pas de limite. */
  spotsLeft: number | null;
};

export function listVisibleOutings(db: Db, viewerId: string, now = new Date()): OpenOuting[] {
  const today = utcToParisInputs(now).date;
  const rows = db.select({ o: outing, organizer: user.name }).from(outing)
    .innerJoin(user, eq(user.id, outing.createdBy)) // « proposée par » : vaut aussi pour une publique sans propriétaire
    .where(and(eq(outing.status, 'planned'), sql`${outing.createdBy} <> ${viewerId}`, or(eq(outing.visibility, 'public'), eq(outing.visibility, 'friends'))))
    .all()
    // Droits : `outingPermissions` (#1455). Une publique est visible de tout compte, une « copains » de ses copains.
    .filter(({ o }) => o.ownerId !== viewerId && outingPermissions(db, { userId: viewerId }, o).canView)
    // Même règle que `isDone` : une sortie « planned » reste à venir jusqu'à la fin de son jour civil de Paris.
    .filter(({ o }) => utcToParisInputs(o.startsAt).date >= today);
  if (!rows.length) return [];

  // Réponses « je viens » (liens non révoqués) en une requête ; sorties déjà rejointes par le compte.
  const invs = db.select({ outingId: invitation.outingId, status: invitation.status, userId: invitation.userId })
    .from(invitation).where(isNull(invitation.revokedAt)).all();
  const yes = new Map<string, number>();
  const joined = new Set<string>();
  for (const i of invs) {
    if (i.status === 'yes') yes.set(i.outingId, (yes.get(i.outingId) ?? 0) + 1);
    if (i.userId === viewerId) joined.add(i.outingId);
  }

  return rows
    .filter(({ o }) => !joined.has(o.id))
    .sort((a, b) => a.o.startsAt.getTime() - b.o.startsAt.getTime())
    .map(({ o, organizer }) => {
      const yesCount = yes.get(o.id) ?? 0;
      return {
        id: o.id, title: o.title, startsAt: o.startsAt, organizerName: organizer, meetingLabel: o.meetingLabel,
        distanceM: o.trackSnapshot.distanceM, gainM: o.trackSnapshot.elevationGainM ?? null,
        level: o.level, ebike: o.ebike, visibility: o.visibility as 'public' | 'friends', yesCount,
        spotsLeft: o.maxParticipants == null ? null : Math.max(0, o.maxParticipants - yesCount),
      };
    });
}

export type JoinResult = { ok: true; already: boolean } | { ok: false; error: 'not_found' | 'closed' | 'full' };

/**
 * Rejoindre une sortie visible avec son compte (#1444, epic #1440) : crée l'invitation au prénom du compte,
 * réponse « je viens » directement, origine `self`. Une seule par compte et par sortie.
 * La sortie est désignée par son `id` (jamais par le slug organisateur, que `OpenOuting` n'expose pas).
 * Non visible, inconnue, ou sortie de l'utilisateur ⇒ `not_found` (même réponse : rien ne fuit).
 * Une invitation révoquée par l'organisateur n'est pas recréée (`not_found`).
 */
export function joinVisibleOuting(db: Db, userId: string, outingId: string, now = new Date()): JoinResult {
  const o = db.select().from(outing).where(eq(outing.id, outingId)).get();
  const perms = o && outingPermissions(db, { userId }, o, now);
  if (!o || !perms || perms.isOwner || o.createdBy === userId || !perms.canView) return { ok: false, error: 'not_found' };
  const existing = db.select().from(invitation).where(and(eq(invitation.outingId, o.id), eq(invitation.userId, userId))).get();
  if (existing) return existing.revokedAt ? { ok: false, error: 'not_found' } : { ok: true, already: true };
  if (isClosed(o, now)) return { ok: false, error: 'closed' };
  if (o.maxParticipants != null && countYes(db, o.id) >= o.maxParticipants) return { ok: false, error: 'full' };
  const u = db.select({ name: user.name }).from(user).where(eq(user.id, userId)).get();
  const name = (u?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!name) return { ok: false, error: 'not_found' };
  const { tokenHash, tokenEnc } = newInviteToken();
  db.insert(invitation).values({
    outingId: o.id, tokenHash, tokenEnc, name, userId, origin: 'self', status: 'yes', respondedAt: now,
  }).run();
  return { ok: true, already: false };
}

export type JoinedOuting = { id: string; title: string; startsAt: Date; organizerName: string; status: OutingRow['status']; level: OutingRow['level']; ebike: OutingRow['ebike'] };

/** Sorties d'autres comptes rejointes avec mon compte (invitation non révoquée liée), à venir d'abord. */
export function listJoinedOutings(db: Db, userId: string): JoinedOuting[] {
  return db.select({ o: outing, organizer: user.name }).from(invitation)
    .innerJoin(outing, eq(outing.id, invitation.outingId))
    .innerJoin(user, eq(user.id, outing.createdBy))
    .where(and(eq(invitation.userId, userId), isNull(invitation.revokedAt), sql`${outing.createdBy} <> ${userId}`))
    .all()
    .filter(({ o }) => o.ownerId !== userId) // confiée à ce compte (#1459) : elle est dans « Mes sorties »
    .sort((a, b) => a.o.startsAt.getTime() - b.o.startsAt.getTime())
    .map(({ o, organizer }) => ({ id: o.id, title: o.title, startsAt: o.startsAt, organizerName: organizer, status: o.status, level: o.level, ebike: o.ebike }));
}

/**
 * Rouvrir la page participant (#1456) : **déchiffre** le lien existant de l'invitation liée à ce compte, sans rien
 * régénérer (l'abonnement agenda reste valable). `not_found` si pas rejoint / révoqué ; `linkUnavailable` pour un
 * lien créé avant le chiffrement.
 */
export function reopenJoinedOuting(db: Db, userId: string, outingId: string): { ok: true; token: string } | { ok: false; error: 'not_found' | 'linkUnavailable' } {
  const inv = db.select().from(invitation).where(and(eq(invitation.outingId, outingId), eq(invitation.userId, userId), isNull(invitation.revokedAt))).get();
  if (!inv) return { ok: false, error: 'not_found' };
  const token = decryptToken(inv.tokenEnc);
  return token ? { ok: true, token } : { ok: false, error: 'linkUnavailable' };
}
