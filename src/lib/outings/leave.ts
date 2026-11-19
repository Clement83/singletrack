import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outing, outingArchive, user, type OutingRow } from '@/db/schema';
import { sendInBackground, sendMail, type Mailer } from '@/lib/mail';
import { outingNoticeMail } from '@/lib/mail-templates';
import { formatOutingDate } from '@/lib/format';
import { isLocale, DEFAULT_LOCALE } from '@/i18n/config';
import { getOwnedOuting, makePublic, setStatus, type Result } from './service';
import { decryptToken } from './tokens';

/**
 * Leave, archive, owner leaving (#1459, epic #1463 P5).
 * - **Archive**: per person (`outing_archive`), without changing anything else. A past outing is archived by default,
 *   unless the person un-archived it (row `archived = false`).
 * - **Leave** (upcoming outing): answer "no" + outing archived for that person only.
 * - **Owner of a private outing**: must choose (delete = cancel + email, make public, hand over); never an automatic cancellation.
 */
const GRACE_MS = 6 * 3600_000;

export type LeaveResult<T = object> = ({ ok: true } & T) | { ok: false; error: 'not_found' | 'closed' | 'ownerMustChoose' | 'notCandidate' | 'outingFrozen' | 'invalid' };

/** An outing is "past" 6 h after its start (like `listOutings`) or once marked done. */
export const isPastOuting = (o: Pick<OutingRow, 'status' | 'startsAt'>, now = new Date()): boolean =>
  o.status === 'done' || o.startsAt.getTime() + GRACE_MS < now.getTime();

/** The user's explicit choices: `outingId → archived`. */
export function archiveOverrides(db: Db, userId: string): Map<string, boolean> {
  return new Map(db.select().from(outingArchive).where(eq(outingArchive.userId, userId)).all().map((r) => [r.outingId, r.archived]));
}

/** Archived for this person: their choice, otherwise by default if the outing is past. */
export const isArchivedFor = (overrides: Map<string, boolean>, o: Pick<OutingRow, 'id' | 'status' | 'startsAt'>, now = new Date()): boolean =>
  overrides.get(o.id) ?? isPastOuting(o, now);

function setArchived(db: Db, userId: string, outingId: string, archived: boolean) {
  db.insert(outingArchive).values({ outingId, userId, archived, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [outingArchive.outingId, outingArchive.userId], set: { archived, updatedAt: new Date() } }).run();
}

/** Outing this account is attached to: owner, creator of a public outing, or non-revoked linked invitation. */
function relation(db: Db, userId: string, outingId: string) {
  const o = db.select().from(outing).where(eq(outing.id, outingId)).get();
  if (!o) return undefined;
  const inv = db.select().from(invitation).where(and(eq(invitation.outingId, o.id), eq(invitation.userId, userId), isNull(invitation.revokedAt))).get();
  const owner = o.ownerId === userId;
  const creatorOfPublic = o.ownerId == null && o.createdBy === userId;
  return owner || creatorOfPublic || inv ? { o, inv, owner } : undefined;
}

/** Archive / un-archive for oneself. Unknown or unrelated to the account ⇒ `not_found`. */
export function archiveOuting(db: Db, userId: string, outingId: string, archived: boolean): LeaveResult {
  if (!relation(db, userId, outingId)) return { ok: false, error: 'not_found' };
  setArchived(db, userId, outingId, archived);
  return { ok: true };
}

/**
 * Leave an upcoming outing: answer "no" (the others see "no longer coming") and outing hidden for oneself only.
 * The owner of a private outing does not go through here (`ownerMustChoose`): they choose through `ownerDepart`.
 */
export function leaveOuting(db: Db, userId: string, outingId: string, now = new Date()): LeaveResult {
  const r = relation(db, userId, outingId);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.owner) return { ok: false, error: 'ownerMustChoose' };
  if (isPastOuting(r.o, now)) return { ok: false, error: 'closed' };
  db.transaction((tx) => {
    if (r.inv && r.inv.status !== 'no') {
      tx.update(invitation).set({ status: 'no', respondedAt: now, updatedAt: now }).where(eq(invitation.id, r.inv.id)).run();
    }
    tx.insert(outingArchive).values({ outingId, userId, archived: true, updatedAt: now })
      .onConflictDoUpdate({ target: [outingArchive.outingId, outingArchive.userId], set: { archived: true, updatedAt: now } }).run();
  });
  return { ok: true };
}

/** Participants (non-revoked invitation, linked to an account, except "no") with their account, except `exceptUserId`. */
export function accountParticipants(db: Db, outingId: string, exceptUserId?: string) {
  return db.select({ userId: user.id, name: user.name, email: user.email, locale: user.locale, tokenEnc: invitation.tokenEnc, status: invitation.status })
    .from(invitation).innerJoin(user, eq(user.id, invitation.userId))
    .where(and(eq(invitation.outingId, outingId), isNull(invitation.revokedAt)))
    .all().filter((p) => p.status !== 'no' && p.userId !== exceptUserId);
}

/** Candidates to take over: participants with an account (not the current owner). */
export const transferCandidates = (db: Db, outingId: string, ownerId: string) =>
  accountParticipants(db, outingId, ownerId).map((p) => ({ userId: p.userId, name: p.name }));

const baseUrl = () => (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '');

function notify(mailer: Mailer, kind: 'cancelled' | 'transferred', o: OutingRow, who: string, to: ReturnType<typeof accountParticipants>[number], url: string | null) {
  const locale = isLocale(to.locale) ? to.locale : DEFAULT_LOCALE;
  sendInBackground(mailer, outingNoticeMail(to.email, { kind, who, title: o.title, date: formatOutingDate(o.startsAt, locale), url }, locale));
}

/** "Delete" an outing = cancel it (nothing is erased) + email to the participants who have an account. Never automatic. */
export function cancelOuting(db: Db, userId: string, slug: string, mailer: Mailer = sendMail): Result {
  const o = getOwnedOuting(db, userId, slug);
  if (!o) return { ok: false, error: 'not_found' };
  const res = setStatus(db, userId, slug, 'cancelled');
  if (!res.ok || o.status === 'cancelled') return res;
  const actor = db.select({ name: user.name }).from(user).where(eq(user.id, userId)).get();
  for (const p of accountParticipants(db, o.id, userId)) {
    const t = decryptToken(p.tokenEnc);
    notify(mailer, 'cancelled', o, actor?.name ?? '', p, t ? `${baseUrl()}/i/${t}` : null);
  }
  return { ok: true };
}

export type OwnerChoice = { choice: 'delete' } | { choice: 'public' } | { choice: 'transfer'; newOwnerId: string };

/** The owner of a private outing leaves: delete / make public / hand over. They then archive the outing for themselves. */
export function ownerDepart(db: Db, userId: string, slug: string, c: OwnerChoice, mailer: Mailer = sendMail): LeaveResult {
  const o = getOwnedOuting(db, userId, slug);
  if (!o) return { ok: false, error: 'not_found' };
  if (c.choice === 'delete') {
    const r = cancelOuting(db, userId, slug, mailer);
    if (!r.ok) return { ok: false, error: r.error === 'not_found' ? 'not_found' : 'invalid' };
  } else if (c.choice === 'public') {
    const r = makePublic(db, userId, slug);
    if (!r.ok) return { ok: false, error: 'not_found' };
  } else if (c.choice === 'transfer') {
    const cand = typeof c.newOwnerId === 'string' ? accountParticipants(db, o.id, userId).find((p) => p.userId === c.newOwnerId) : undefined;
    if (!cand) return { ok: false, error: 'notCandidate' };
    db.update(outing).set({ ownerId: cand.userId, updatedAt: new Date() }).where(eq(outing.id, o.id)).run();
    const actor = db.select({ name: user.name }).from(user).where(eq(user.id, userId)).get();
    notify(mailer, 'transferred', o, actor?.name ?? '', cand, `${baseUrl()}/s/${o.slug}`);
  } else return { ok: false, error: 'invalid' };
  setArchived(db, userId, o.id, true);
  return { ok: true };
}
