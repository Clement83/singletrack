import { and, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import type { Db } from '@/db';
import { friendship, handleHistory, user } from '@/db/schema';

/**
 * Federated identifier (`handle`, #1474, rule of docs/federation.md §2): `[a-z0-9_]{3,30}`, lower case, unique.
 * Address = `handle@domain`. Generated from the first name (never the email), changeable only once.
 */
export const HANDLE_RE = /^[a-z0-9_]{3,30}$/;

/** Forbidden handles (ActivityPub routes, service names): an account cannot take them. */
export const RESERVED_HANDLES = new Set([
  'admin', 'administrator', 'root', 'support', 'ap', 'api', 'inbox', 'outbox', 'actor', 'actors', 'instance', 'singletrack',
  'nodeinfo', 'well_known', 'wellknown', 'webfinger', 'users', 'user', 'system', 'moderator', 'mod', 'help', 'info', 'null', 'undefined',
]);

export const isReservedHandle = (h: string) => RESERVED_HANDLES.has(h.toLowerCase().replace(/-/g, '_'));

/** Base of a handle from a first name: lower case, accents removed, anything outside `[a-z0-9_]` dropped, padded to 3 characters, truncated. */
export function handleBase(name: string): string {
  let base = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (base.length < 3) base = `user${base}`.length >= 3 ? `user${base}` : 'user';
  return base.slice(0, 26);
}

function taken(db: Db, handle: string, selfId?: string): boolean {
  if (isReservedHandle(handle)) return true;
  const u = db.select({ id: user.id }).from(user).where(selfId ? and(eq(user.handle, handle), ne(user.id, selfId)) : eq(user.handle, handle)).get();
  if (u) return true;
  const h = db.select({ userId: handleHistory.userId }).from(handleHistory).where(eq(handleHistory.handle, handle)).get();
  return !!h && h.userId !== selfId;
}

/** Premier handle libre : `alice`, `alice2`, `alice3`… */
export function generateHandle(db: Db, name: string, selfId?: string): string {
  const base = handleBase(name);
  if (!taken(db, base, selfId)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!taken(db, candidate, selfId)) return candidate;
  }
}

/** Gives the account a handle if it has a first name and no handle yet. Returns the handle (or null without a first name). */
export function ensureHandle(db: Db, userId: string): string | null {
  const row = db.select({ name: user.name, handle: user.handle }).from(user).where(eq(user.id, userId)).get();
  if (!row) return null;
  if (row.handle) return row.handle;
  if (!row.name.trim()) return null;
  // Two simultaneous creations: the unique index decides, retry with the next one.
  for (let i = 0; i < 5; i++) {
    const handle = generateHandle(db, row.name, userId);
    try {
      db.update(user).set({ handle }).where(and(eq(user.id, userId), isNull(user.handle))).run();
      return db.select({ h: user.handle }).from(user).where(eq(user.id, userId)).get()?.h ?? null;
    } catch { /* uniqueness conflict: draw again */ }
  }
  return null;
}

/** Catches up existing accounts (created before #1474) that have a first name. Called at start-up. */
export function backfillHandles(db: Db): number {
  const rows = db.select({ id: user.id }).from(user).where(isNull(user.handle)).all();
  return rows.filter((r) => ensureHandle(db, r.id)).length;
}

/** Remote friends of the account (requests included): changing address would break them (no `Move` in v1, #1475). */
export function hasRemoteFriends(db: Db, userId: string): boolean {
  return !!db.select({ id: friendship.id }).from(friendship)
    .where(and(isNotNull(friendship.remoteActorId), or(eq(friendship.requesterId, userId), eq(friendship.addresseeId, userId)))).get();
}

export type ChangeHandleError = 'invalid' | 'reserved' | 'taken' | 'already_changed' | 'remote_friends' | 'no_handle' | 'same';

/** Single change of the handle (user menu). */
export function changeHandle(db: Db, userId: string, input: unknown): { ok: true; handle: string } | { ok: false; error: ChangeHandleError } {
  const next = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (!HANDLE_RE.test(next)) return { ok: false, error: 'invalid' };
  const row = db.select({ handle: user.handle, changedAt: user.handleChangedAt }).from(user).where(eq(user.id, userId)).get();
  if (!row?.handle) return { ok: false, error: 'no_handle' };
  if (row.handle === next) return { ok: false, error: 'same' };
  if (row.changedAt) return { ok: false, error: 'already_changed' };
  if (isReservedHandle(next)) return { ok: false, error: 'reserved' };
  if (hasRemoteFriends(db, userId)) return { ok: false, error: 'remote_friends' };
  if (taken(db, next, userId)) return { ok: false, error: 'taken' };
  try {
    db.transaction((tx) => {
      tx.insert(handleHistory).values({ handle: row.handle!, userId }).onConflictDoNothing().run();
      tx.update(user).set({ handle: next, handleChangedAt: new Date(), updatedAt: new Date() }).where(and(eq(user.id, userId), isNull(user.handleChangedAt))).run();
    });
  } catch {
    return { ok: false, error: 'taken' };
  }
  return { ok: true, handle: next };
}

export function getHandle(db: Db, userId: string): { handle: string | null; canChange: boolean } {
  const row = db.select({ handle: user.handle, changedAt: user.handleChangedAt }).from(user).where(eq(user.id, userId)).get();
  return { handle: row?.handle ?? null, canChange: !!row?.handle && !row.changedAt && !hasRemoteFriends(db, userId) };
}

export function userIdByHandle(db: Db, handle: string): string | null {
  return db.select({ id: user.id }).from(user).where(and(isNotNull(user.handle), eq(user.handle, handle.toLowerCase()))).get()?.id ?? null;
}
