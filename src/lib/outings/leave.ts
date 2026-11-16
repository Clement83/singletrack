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
 * Quitter, archiver, départ du propriétaire (#1459, epic #1463 P5).
 * - **Archiver** : par personne (`outing_archive`), sans rien changer d'autre. Une sortie passée est archivée d'office,
 *   sauf si la personne l'a désarchivée (ligne `archived = false`).
 * - **Quitter** (sortie à venir) : réponse « non » + sortie archivée pour cette personne seulement.
 * - **Propriétaire d'une privée** : doit choisir (supprimer = annuler + mail, rendre publique, confier) ; jamais d'annulation automatique.
 */
const GRACE_MS = 6 * 3600_000;

export type LeaveResult<T = object> = ({ ok: true } & T) | { ok: false; error: 'not_found' | 'closed' | 'ownerMustChoose' | 'notCandidate' | 'outingFrozen' | 'invalid' };

/** Une sortie est « passée » 6 h après son départ (comme `listOutings`) ou une fois marquée faite. */
export const isPastOuting = (o: Pick<OutingRow, 'status' | 'startsAt'>, now = new Date()): boolean =>
  o.status === 'done' || o.startsAt.getTime() + GRACE_MS < now.getTime();

/** Choix explicites de l'utilisateur : `outingId → archived`. */
export function archiveOverrides(db: Db, userId: string): Map<string, boolean> {
  return new Map(db.select().from(outingArchive).where(eq(outingArchive.userId, userId)).all().map((r) => [r.outingId, r.archived]));
}

/** Archivée pour cette personne : son choix, sinon d'office si la sortie est passée. */
export const isArchivedFor = (overrides: Map<string, boolean>, o: Pick<OutingRow, 'id' | 'status' | 'startsAt'>, now = new Date()): boolean =>
  overrides.get(o.id) ?? isPastOuting(o, now);

function setArchived(db: Db, userId: string, outingId: string, archived: boolean) {
  db.insert(outingArchive).values({ outingId, userId, archived, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [outingArchive.outingId, outingArchive.userId], set: { archived, updatedAt: new Date() } }).run();
}

/** Sortie à laquelle ce compte est rattaché : propriétaire, créateur d'une publique, ou invitation liée non révoquée. */
function relation(db: Db, userId: string, outingId: string) {
  const o = db.select().from(outing).where(eq(outing.id, outingId)).get();
  if (!o) return undefined;
  const inv = db.select().from(invitation).where(and(eq(invitation.outingId, o.id), eq(invitation.userId, userId), isNull(invitation.revokedAt))).get();
  const owner = o.ownerId === userId;
  const creatorOfPublic = o.ownerId == null && o.createdBy === userId;
  return owner || creatorOfPublic || inv ? { o, inv, owner } : undefined;
}

/** Archiver / désarchiver pour soi. Inconnue ou sans lien avec le compte ⇒ `not_found`. */
export function archiveOuting(db: Db, userId: string, outingId: string, archived: boolean): LeaveResult {
  if (!relation(db, userId, outingId)) return { ok: false, error: 'not_found' };
  setArchived(db, userId, outingId, archived);
  return { ok: true };
}

/**
 * Quitter une sortie à venir : réponse « non » (les autres voient « ne vient plus ») et sortie masquée pour soi seulement.
 * Le propriétaire d'une privée ne passe pas par ici (`ownerMustChoose`) : il choisit via `ownerDepart`.
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

/** Participants (invitation non révoquée, liée à un compte, hors « non ») avec leur compte, hors `exceptUserId`. */
export function accountParticipants(db: Db, outingId: string, exceptUserId?: string) {
  return db.select({ userId: user.id, name: user.name, email: user.email, locale: user.locale, tokenEnc: invitation.tokenEnc, status: invitation.status })
    .from(invitation).innerJoin(user, eq(user.id, invitation.userId))
    .where(and(eq(invitation.outingId, outingId), isNull(invitation.revokedAt)))
    .all().filter((p) => p.status !== 'no' && p.userId !== exceptUserId);
}

/** Candidats à la reprise : participants avec compte (pas l'actuel propriétaire). */
export const transferCandidates = (db: Db, outingId: string, ownerId: string) =>
  accountParticipants(db, outingId, ownerId).map((p) => ({ userId: p.userId, name: p.name }));

const baseUrl = () => (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '');

function notify(mailer: Mailer, kind: 'cancelled' | 'transferred', o: OutingRow, who: string, to: ReturnType<typeof accountParticipants>[number], url: string | null) {
  const locale = isLocale(to.locale) ? to.locale : DEFAULT_LOCALE;
  sendInBackground(mailer, outingNoticeMail(to.email, { kind, who, title: o.title, date: formatOutingDate(o.startsAt, locale), url }, locale));
}

/** « Supprimer » une sortie = l'annuler (rien n'est effacé) + mail aux participants qui ont un compte. Jamais automatique. */
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

/** Le propriétaire d'une privée quitte : supprimer / rendre publique / confier. Il archive ensuite la sortie pour lui. */
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
