import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outingComment, type OutingRow } from '@/db/schema';
import { getInvitationByToken, getManagedOuting, isClosed } from './service';
import { outingPermissions } from './permissions';

export const COMMENT_MAX = 1000;

/** Who writes: a guest (through their personal link) or the organiser (through their session). */
export type Actor = { kind: 'guest'; invitationId: string } | { kind: 'organizer'; userId: string };

export type CommentView = {
  id: string;
  author: string;
  organizer: boolean;
  body: string;
  createdAt: string;
  edited: boolean;
  mine: boolean;
  /** The actor may delete it (author, or organiser = moderation). */
  canDelete: boolean;
  canEdit: boolean;
};

export type CommentResult<T = object> = ({ ok: true } & T) | { ok: false; error: 'not_found' | 'closed' | 'invalid' | 'forbidden'; errors?: Record<string, string> };

/** Resolves the context of a guest link: outing + actor. Unknown or revoked link → undefined (404). */
export function guestContext(db: Db, token: string): { outing: OutingRow; actor: Actor; canModerate: false } | undefined {
  const found = getInvitationByToken(db, token);
  return found ? { outing: found.outing, actor: { kind: 'guest', invitationId: found.invitation.id }, canModerate: false } : undefined;
}

/** Organiser context: owner (moderates) or creator of a public outing (comments, does not moderate). */
export function organizerContext(db: Db, userId: string, slug: string): { outing: OutingRow; actor: Actor; canModerate: boolean } | undefined {
  const o = getManagedOuting(db, userId, slug);
  return o ? { outing: o, actor: { kind: 'organizer', userId }, canModerate: outingPermissions(db, { userId }, o).canModerateComment } : undefined;
}

export function cleanBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const b = raw.replace(/\r\n/g, '\n').trim();
  return b.length >= 1 && b.length <= COMMENT_MAX ? b : null;
}

function isMine(row: { invitationId: string | null; authorUserId: string | null }, actor: Actor): boolean {
  return actor.kind === 'guest' ? row.invitationId === actor.invitationId : row.invitationId === null && row.authorUserId === actor.userId;
}

/** Chronological thread (newest at the bottom). Only raw text goes out: no HTML is interpreted when displayed. */
export function listComments(db: Db, outingId: string, actor: Actor): CommentView[] {
  const rows = db
    .select({ c: outingComment, name: invitation.name })
    .from(outingComment)
    .leftJoin(invitation, eq(invitation.id, outingComment.invitationId))
    .where(and(eq(outingComment.outingId, outingId), isNull(outingComment.deletedAt)))
    .orderBy(asc(outingComment.createdAt), asc(outingComment.id))
    .all();
  return rows.map(({ c, name }) => {
    const mine = isMine(c, actor);
    return {
      id: c.id,
      author: name ?? '',
      organizer: c.invitationId === null,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      edited: !!c.editedAt,
      mine,
      canEdit: mine,
      canDelete: mine || actor.kind === 'organizer',
    };
  });
}

export function addComment(db: Db, o: OutingRow, actor: Actor, raw: unknown, now = new Date()): CommentResult<{ id: string }> {
  // The thread freezes like the answers: outing cancelled or started more than 6 h ago.
  if (isClosed(o, now)) return { ok: false, error: 'closed' };
  const body = cleanBody(raw);
  if (!body) return { ok: false, error: 'invalid', errors: { body: typeof raw === 'string' && raw.trim().length > COMMENT_MAX ? 'tooLong' : 'empty' } };
  const row = db
    .insert(outingComment)
    .values({
      outingId: o.id,
      invitationId: actor.kind === 'guest' ? actor.invitationId : null,
      authorUserId: actor.kind === 'organizer' ? actor.userId : null,
      body,
      createdAt: now,
    })
    .returning({ id: outingComment.id })
    .get();
  return { ok: true, id: row.id };
}

function find(db: Db, outingId: string, id: string) {
  return db.select().from(outingComment).where(and(eq(outingComment.id, id), eq(outingComment.outingId, outingId), isNull(outingComment.deletedAt))).get();
}

/** Only the author edits their message (even the organiser does not rewrite other people's). */
export function editComment(db: Db, o: OutingRow, actor: Actor, id: string, raw: unknown, now = new Date()): CommentResult {
  const c = find(db, o.id, id);
  if (!c) return { ok: false, error: 'not_found' };
  if (!isMine(c, actor)) return { ok: false, error: 'forbidden' };
  if (isClosed(o, now)) return { ok: false, error: 'closed' };
  const body = cleanBody(raw);
  if (!body) return { ok: false, error: 'invalid', errors: { body: 'empty' } };
  db.update(outingComment).set({ body, editedAt: now }).where(eq(outingComment.id, c.id)).run();
  return { ok: true };
}

/** The author deletes their own; the organiser deletes any message (moderation). */
export function deleteComment(db: Db, o: OutingRow, actor: Actor, id: string, now = new Date()): CommentResult {
  const c = find(db, o.id, id);
  if (!c) return { ok: false, error: 'not_found' };
  if (!isMine(c, actor) && actor.kind !== 'organizer') return { ok: false, error: 'forbidden' };
  db.update(outingComment).set({ deletedAt: now }).where(eq(outingComment.id, c.id)).run();
  return { ok: true };
}
