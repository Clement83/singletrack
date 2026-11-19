import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import {
  contact, federationBlock, federationLog, federationReport, friendship, invitation, remoteActor, remoteActorBlock, remoteOuting, remoteResponse,
} from '@/db/schema';
import { rateLimit } from '@/lib/outings/rate-limit';

/**
 * Federation security and moderation (#1477, docs/federation.md §11). Instance open to every server: everything coming
 * in is bounded (size, rate, clock, signature), any server or account can be cut off, and every rejection is logged
 * (domain + reason + activity type, never content). Blocks also apply to outgoing deliveries.
 */

export const LIMITS = {
  /** Maximum size of a received activity (track included). */
  maxActivityBytes: 256 * 1024,
  /** Activities per remote server and per minute on the inboxes. */
  ratePerMinute: 60,
  /** Remote outings kept in cache per origin server. */
  maxCachedOutingsPerServer: 200,
  /** A copy expires 30 days after the outing starts. */
  cacheExpiryMs: 30 * 86_400_000,
  /** Friend requests from a never-seen server, per day and per recipient account. */
  unseenServerRequestsPerDay: 5,
  /** Tolerance on the signed date (`Date` header). */
  clockSkewHours: 12,
  /** Entries kept in the rejection log. */
  logKeep: 1000,
  /** Lines read in a block-list import. */
  maxImportRows: 5000,
} as const;

// ───────────────────────── Administrateur ─────────────────────────

/** `ADMIN_EMAILS` (comma-separated list, case-insensitive): only these accounts open `/admin/federation`. */
export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}
export function isAdminEmail(email: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return !!email && adminEmails(env).includes(email.trim().toLowerCase());
}

// ───────────────────────── Blocked servers ─────────────────────────

/** `Mastodon.Example`, `https://x.org/path`, `x.org:8443` → lower-case host; null if it is not a host name. */
export function normalizeDomain(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let v = input.trim().toLowerCase();
  if (!v) return null;
  if (v.includes('://')) { try { v = new URL(v).host; } catch { return null; } }
  v = v.replace(/^\*\./, '').replace(/\/.*$/, '').replace(/\.$/, '');
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/.test(v) && v.length <= 253 ? v : null;
}

/** Blocked = the domain or one of its parents is in the list (`evil.example` blocks `x.evil.example`). The port is ignored for parents. */
export function isDomainBlocked(db: Db, domain: string | null | undefined): boolean {
  const d = normalizeDomain(domain);
  if (!d) return false;
  const host = d.replace(/:\d+$/, '');
  const parts = host.split('.');
  const candidates = new Set<string>([d, host]);
  for (let i = 1; i < parts.length - 1; i++) candidates.add(parts.slice(i).join('.'));
  return !!db.select({ n: count() }).from(federationBlock).where(inArray(federationBlock.domain, [...candidates])).get()?.n;
}

/** Removes what this server had given us: friends, cached outings, invitations; buddy-book links are detached. */
export function purgeDomain(db: Db, domain: string): void {
  const ids = db.select({ id: remoteActor.id, host: remoteActor.domain }).from(remoteActor).all()
    .filter((a) => {
      const h = a.host.replace(/:\d+$/, ''), d = domain.replace(/:\d+$/, '');
      return a.host === domain || h === d || h.endsWith(`.${d}`);
    })
    .map((a) => a.id);
  if (!ids.length) return;
  db.delete(friendship).where(inArray(friendship.remoteActorId, ids)).run();
  db.delete(remoteOuting).where(inArray(remoteOuting.remoteActorId, ids)).run();
  db.update(contact).set({ remoteActorId: null }).where(inArray(contact.remoteActorId, ids)).run();
  db.update(invitation).set({ revokedAt: new Date() }).where(and(inArray(invitation.remoteActorId, ids), isNull(invitation.revokedAt))).run();
}

export function blockDomain(db: Db, input: unknown, reason: string | null = null, source: 'admin' | 'import' = 'admin'): string | null {
  const domain = normalizeDomain(input);
  if (!domain) return null;
  db.insert(federationBlock).values({ domain, reason: reason?.trim().slice(0, 300) || null, source })
    .onConflictDoUpdate({ target: federationBlock.domain, set: { reason: reason?.trim().slice(0, 300) || null } }).run();
  purgeDomain(db, domain);
  return domain;
}

export function unblockDomain(db: Db, input: unknown): boolean {
  const domain = normalizeDomain(input);
  return !!domain && db.delete(federationBlock).where(eq(federationBlock.domain, domain)).run().changes > 0;
}

export const listBlockedDomains = (db: Db) => db.select().from(federationBlock).orderBy(federationBlock.domain).all();

/**
 * Import of a shared block list, CSV in Mastodon format (`#domain,#severity,#reject_media,#reject_reports,#public_comment,#obfuscate`).
 * Only `suspend` lines (or without severity) are kept: `silence` and `noop` do not cut federation. Masked domains (`*`) ignored.
 */
export function importBlockList(db: Db, csv: string): { added: number; skipped: number } {
  let added = 0, skipped = 0;
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).slice(0, LIMITS.maxImportRows + 1);
  const header = lines[0]?.toLowerCase().includes('domain') ? lines.shift()!.toLowerCase().split(',').map((c) => c.replace(/^#/, '').trim()) : ['domain', 'severity'];
  const iDomain = Math.max(header.indexOf('domain'), 0);
  const iSev = header.indexOf('severity');
  const iComment = header.indexOf('public_comment');
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const sev = iSev >= 0 ? (cols[iSev] ?? '').toLowerCase() : 'suspend';
    const d = cols[iDomain]?.includes('*') ? null : normalizeDomain(cols[iDomain]);
    if (!d || (sev && sev !== 'suspend')) { skipped++; continue; }
    const had = db.select({ n: count() }).from(federationBlock).where(eq(federationBlock.domain, d)).get()?.n;
    blockDomain(db, d, iComment >= 0 ? cols[iComment] || null : null, 'import');
    if (!had) added++; else skipped++;
  }
  return { added, skipped };
}

// ───────────────────────── Rejection log ─────────────────────────

export type RefusalReason = 'blocked' | 'blocked_actor' | 'signature' | 'rate_limit' | 'too_large' | 'friend_quota' | 'cache_full' | 'invalid';

/** One row per rejected activity: domain (or null), reason, activity type. No content, no account. Bounded to `logKeep` rows. */
export function logRefusal(db: Db, e: { domain?: string | null; reason: RefusalReason; activity?: string | null }, now = new Date()): void {
  try {
    db.insert(federationLog).values({ domain: e.domain ?? null, reason: e.reason, activity: e.activity?.slice(0, 40) ?? null, at: now }).run();
    const total = db.select({ n: count() }).from(federationLog).get()?.n ?? 0;
    if (total > LIMITS.logKeep + 100) {
      const cut = db.select({ at: federationLog.at }).from(federationLog).orderBy(desc(federationLog.at)).limit(1).offset(LIMITS.logKeep).get();
      if (cut) db.delete(federationLog).where(lt(federationLog.at, cut.at)).run();
    }
  } catch (e2) {
    console.warn('[federation] journal', e2 instanceof Error ? e2.message : e2);
  }
}
export const listRefusals = (db: Db, limit = 200) => db.select().from(federationLog).orderBy(desc(federationLog.at)).limit(limit).all();

// ───────────────────────── Inbox guard ─────────────────────────

export type InboxVerdict = { ok: true; domain: string | null } | { ok: false; status: 202 | 403 | 413 | 429; reason: RefusalReason; domain: string | null };

/** Host declared by the activity (`actor`, string or object). **Not verified**: the signature is verified next by Fedify; used for early filtering. */
export function claimedActor(body: unknown): { url: string; domain: string } | null {
  const a = (body as { actor?: unknown } | null)?.actor;
  const url = typeof a === 'string' ? a : typeof (a as { id?: unknown } | null)?.id === 'string' ? (a as { id: string }).id : null;
  try { return url ? { url: new URL(url).href, domain: new URL(url).host.toLowerCase() } : null; } catch { return null; }
}

/**
 * Early filter of a received activity, before any signature verification and any expensive work:
 * size, blocked server, rate per server, `Delete` from an unknown actor (ignored: Mastodon sends them in bulk, nothing to remove).
 */
export function screenInbox(db: Db, input: { size: number; body: unknown }, now = Date.now()): InboxVerdict {
  const claimed = claimedActor(input.body);
  const domain = claimed?.domain ?? null;
  if (input.size > LIMITS.maxActivityBytes) return { ok: false, status: 413, reason: 'too_large', domain };
  if (!claimed) return { ok: true, domain: null }; // Fedify will reject it (missing signature / actor); no domain to count
  if (isDomainBlocked(db, domain)) return { ok: false, status: 403, reason: 'blocked', domain };
  const type = (input.body as { type?: unknown }).type;
  if (type === 'Delete' && !db.select({ id: remoteActor.id }).from(remoteActor).where(eq(remoteActor.actorUrl, claimed.url)).get()) {
    return { ok: false, status: 202, reason: 'invalid', domain };
  }
  if (!rateLimit(`inbox:${domain}`, LIMITS.ratePerMinute, 60_000, now)) return { ok: false, status: 429, reason: 'rate_limit', domain };
  return { ok: true, domain };
}

// ───────────────────────── Accounts blocked by a user ─────────────────────────

export const isActorBlocked = (db: Db, userId: string, remoteActorId: string) =>
  !!db.select({ n: count() }).from(remoteActorBlock).where(and(eq(remoteActorBlock.userId, userId), eq(remoteActorBlock.remoteActorId, remoteActorId))).get()?.n;

/** Blocks a remote account for this account: friendship removed, answers to this actor's outings erased. Idempotent. */
export function blockActor(db: Db, userId: string, remoteActorId: string): boolean {
  if (!db.select({ id: remoteActor.id }).from(remoteActor).where(eq(remoteActor.id, remoteActorId)).get()) return false;
  db.insert(remoteActorBlock).values({ userId, remoteActorId }).onConflictDoNothing().run();
  db.delete(friendship).where(and(eq(friendship.remoteActorId, remoteActorId), sql`(${friendship.requesterId} = ${userId} or ${friendship.addresseeId} = ${userId})`)).run();
  db.update(contact).set({ remoteActorId: null }).where(and(eq(contact.ownerUserId, userId), eq(contact.remoteActorId, remoteActorId))).run();
  const outings = db.select({ id: remoteOuting.id }).from(remoteOuting).where(eq(remoteOuting.remoteActorId, remoteActorId)).all().map((o) => o.id);
  if (outings.length) db.delete(remoteResponse).where(and(eq(remoteResponse.userId, userId), inArray(remoteResponse.remoteOutingId, outings))).run();
  return true;
}

export function unblockActor(db: Db, userId: string, remoteActorId: string): void {
  db.delete(remoteActorBlock).where(and(eq(remoteActorBlock.userId, userId), eq(remoteActorBlock.remoteActorId, remoteActorId))).run();
}

export const listBlockedActors = (db: Db, userId: string) =>
  db.select({ id: remoteActor.id, handle: remoteActor.handle, domain: remoteActor.domain, displayName: remoteActor.displayName })
    .from(remoteActorBlock).innerJoin(remoteActor, eq(remoteActor.id, remoteActorBlock.remoteActorId)).where(eq(remoteActorBlock.userId, userId)).all();

// ───────────────────────── Friend request anti-spam ─────────────────────────

/** A server is "known" as soon as one of our accounts has an accepted friend there. */
function serverSeen(db: Db, domain: string): boolean {
  return !!db.select({ n: count() }).from(friendship).innerJoin(remoteActor, eq(remoteActor.id, friendship.remoteActorId))
    .where(and(eq(friendship.status, 'accepted'), eq(remoteActor.domain, domain))).get()?.n;
}

/** A friend request from a never-seen server is limited to 5 per day and per recipient account. `false` = to reject (silently). */
export function allowFriendRequest(db: Db, userId: string, domain: string, now = new Date()): boolean {
  if (serverSeen(db, domain)) return true;
  const since = new Date(now.getTime() - 86_400_000);
  const rows = db.select({ d: remoteActor.domain }).from(friendship).innerJoin(remoteActor, eq(remoteActor.id, friendship.remoteActorId))
    .where(and(eq(friendship.addresseeId, userId), isNull(friendship.requesterId), isNotNull(friendship.remoteActorId), gte(friendship.createdAt, since))).all();
  const fromUnseen = rows.filter((r) => !serverSeen(db, r.d)).length;
  return fromUnseen < LIMITS.unseenServerRequestsPerDay;
}

// ───────────────────────── Remote outing cache ─────────────────────────

/** Deletes expired copies (30 days after the outing starts). Called on every received outing and at start-up. */
export function pruneRemoteOutings(db: Db, now = new Date()): number {
  return db.delete(remoteOuting).where(lt(remoteOuting.startsAt, new Date(now.getTime() - LIMITS.cacheExpiryMs))).run().changes;
}

/** Room left in this origin server's cache for **a new** copy (updates always go through). */
export function cacheHasRoom(db: Db, remoteActorId: string): boolean {
  const domain = db.select({ d: remoteActor.domain }).from(remoteActor).where(eq(remoteActor.id, remoteActorId)).get()?.d;
  if (!domain) return false;
  const n = db.select({ n: count() }).from(remoteOuting).innerJoin(remoteActor, eq(remoteActor.id, remoteOuting.remoteActorId)).where(eq(remoteActor.domain, domain)).get()?.n ?? 0;
  return n < LIMITS.maxCachedOutingsPerServer;
}

// ───────────────────────── Signalements ─────────────────────────

export const listReports = (db: Db, limit = 100) => db.select().from(federationReport).orderBy(desc(federationReport.createdAt)).limit(limit).all();
