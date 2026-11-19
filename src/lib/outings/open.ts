import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outing, user, type OutingRow } from '@/db/schema';
import { outingPermissions } from './permissions';
import { utcToParisInputs } from './time';
import { countYes, isClosed } from './service';
import { decryptToken, newInviteToken } from './tokens';

/**
 * "Open outings" (#1443, epic #1440): outings of other accounts that the user can discover
 * (`public`, or `friends` + accepted friend), upcoming, not cancelled, not joined by them yet.
 * Deliberately lean summary: never participants' first names, email, token or organiser slug.
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
  /** `null` = no limit. */
  spotsLeft: number | null;
};

export function listVisibleOutings(db: Db, viewerId: string, now = new Date()): OpenOuting[] {
  const today = utcToParisInputs(now).date;
  const rows = db.select({ o: outing, organizer: user.name }).from(outing)
    .innerJoin(user, eq(user.id, outing.createdBy)) // "proposed by": also valid for a public outing without an owner
    .where(and(eq(outing.status, 'planned'), sql`${outing.createdBy} <> ${viewerId}`, or(eq(outing.visibility, 'public'), eq(outing.visibility, 'friends'))))
    .all()
    // Rights: `outingPermissions` (#1455). A public outing is visible to every account, a "friends" one to the friends.
    .filter(({ o }) => o.ownerId !== viewerId && outingPermissions(db, { userId: viewerId }, o).canView)
    // Same rule as `isDone`: a "planned" outing stays upcoming until the end of its Paris calendar day.
    .filter(({ o }) => utcToParisInputs(o.startsAt).date >= today);
  if (!rows.length) return [];

  // "I'm in" answers (non-revoked links) in one query; outings already joined by the account.
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
 * Join a visible outing with one's account (#1444, epic #1440): creates the invitation under the account's first name,
 * answer "I'm in" directly, origin `self`. Only one per account and per outing.
 * The outing is designated by its `id` (never by the organiser slug, which `OpenOuting` does not expose).
 * Not visible, unknown, or the user's own outing ⇒ `not_found` (same answer: nothing leaks).
 * An invitation revoked by the organiser is not recreated (`not_found`).
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

/** Outings of other accounts joined with my account (linked non-revoked invitation), upcoming first. */
export function listJoinedOutings(db: Db, userId: string): JoinedOuting[] {
  return db.select({ o: outing, organizer: user.name }).from(invitation)
    .innerJoin(outing, eq(outing.id, invitation.outingId))
    .innerJoin(user, eq(user.id, outing.createdBy))
    .where(and(eq(invitation.userId, userId), isNull(invitation.revokedAt), sql`${outing.createdBy} <> ${userId}`))
    .all()
    .filter(({ o }) => o.ownerId !== userId) // handed over to this account (#1459): it is in "My outings"
    .sort((a, b) => a.o.startsAt.getTime() - b.o.startsAt.getTime())
    .map(({ o, organizer }) => ({ id: o.id, title: o.title, startsAt: o.startsAt, organizerName: organizer, status: o.status, level: o.level, ebike: o.ebike }));
}

/**
 * Reopen the participant page (#1456): **decrypts** the existing link of the invitation linked to this account, without
 * regenerating anything (the calendar subscription stays valid). `not_found` if not joined / revoked; `linkUnavailable` for a
 * link created before encryption.
 */
export function reopenJoinedOuting(db: Db, userId: string, outingId: string): { ok: true; token: string } | { ok: false; error: 'not_found' | 'linkUnavailable' } {
  const inv = db.select().from(invitation).where(and(eq(invitation.outingId, outingId), eq(invitation.userId, userId), isNull(invitation.revokedAt))).get();
  if (!inv) return { ok: false, error: 'not_found' };
  const token = decryptToken(inv.tokenEnc);
  return token ? { ok: true, token } : { ok: false, error: 'linkUnavailable' };
}
