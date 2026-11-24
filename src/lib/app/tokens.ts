import { randomBytes, randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { appPairing, appToken } from '@/db/schema';
import { hashToken } from '@/lib/outings/tokens';
import { PAIRING_TTL_MS } from './constants';

/** Companion app (#1720): pairing code (QR / typed) → long-lived revocable token. Only hashes are stored. */
export { PAIRING_TTL_MS };
/** No 0/O/1/I/L: the code can be typed by hand. 31^6 ≈ 887 million combinations, 5 minutes, single use, rate-limited. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
const MAX_ACTIVE_CODES = 5;
const MAX_DEVICES = 20;

export function newPairingCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

const normalize = (code: unknown): string | null => {
  if (typeof code !== 'string') return null;
  const c = code.replace(/[\s-]/g, '').toUpperCase();
  return c.length === CODE_LENGTH && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
};

/** Creates a pairing code for the account. Older unused codes beyond the cap are not accepted anymore (oldest first). */
export function createPairing(db: Db, userId: string, now = new Date()): { code: string; expiresAt: Date } {
  const code = newPairingCode();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  db.transaction((tx) => {
    const live = tx.select({ id: appPairing.id }).from(appPairing)
      .where(and(eq(appPairing.userId, userId), isNull(appPairing.usedAt), gt(appPairing.expiresAt, now))).orderBy(desc(appPairing.createdAt)).all();
    for (const old of live.slice(MAX_ACTIVE_CODES - 1)) tx.update(appPairing).set({ usedAt: now }).where(eq(appPairing.id, old.id)).run();
    tx.insert(appPairing).values({ userId, codeHash: hashToken(code), expiresAt, createdAt: now }).run();
  });
  return { code, expiresAt };
}

export type PairResult = { ok: true; token: string; userId: string } | { ok: false };

/** Exchanges a code against a token. Unknown, expired or already used (replay) ⇒ `{ ok: false }` (401). */
export function exchangePairing(db: Db, rawCode: unknown, deviceName: unknown, now = new Date()): PairResult {
  const code = normalize(rawCode);
  if (!code) return { ok: false };
  const name = typeof deviceName === 'string' ? deviceName.trim().slice(0, 60) : '';
  return db.transaction((tx) => {
    const row = tx.select().from(appPairing).where(eq(appPairing.codeHash, hashToken(code))).get();
    if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) return { ok: false as const };
    // Atomic single use: only one concurrent exchange can flip `usedAt`.
    const claimed = tx.update(appPairing).set({ usedAt: now }).where(and(eq(appPairing.id, row.id), isNull(appPairing.usedAt))).returning({ id: appPairing.id }).all();
    if (!claimed.length) return { ok: false as const };
    const devices = tx.select({ id: appToken.id }).from(appToken).where(and(eq(appToken.userId, row.userId), isNull(appToken.revokedAt))).orderBy(appToken.createdAt).all();
    for (const old of devices.slice(0, Math.max(0, devices.length - MAX_DEVICES + 1))) tx.update(appToken).set({ revokedAt: now }).where(eq(appToken.id, old.id)).run();
    const token = randomBytes(32).toString('base64url');
    tx.insert(appToken).values({ userId: row.userId, tokenHash: hashToken(token), deviceName: name || 'Android', createdAt: now }).run();
    return { ok: true as const, token, userId: row.userId };
  });
}

/** `Authorization: Bearer <token>` → account, or null (missing, unknown, revoked). Updates `lastUsedAt` at most once a minute. */
export function authenticateApp(db: Db, req: Request, now = new Date()): { userId: string; tokenId: string } | null {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.get('authorization') ?? '');
  if (!m) return null;
  const row = db.select().from(appToken).where(and(eq(appToken.tokenHash, hashToken(m[1])), isNull(appToken.revokedAt))).get();
  if (!row) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) db.update(appToken).set({ lastUsedAt: now }).where(eq(appToken.id, row.id)).run();
  return { userId: row.userId, tokenId: row.id };
}

export function listDevices(db: Db, userId: string) {
  return db.select({ id: appToken.id, deviceName: appToken.deviceName, createdAt: appToken.createdAt, lastUsedAt: appToken.lastUsedAt })
    .from(appToken).where(and(eq(appToken.userId, userId), isNull(appToken.revokedAt))).orderBy(desc(appToken.createdAt)).all();
}

export function revokeDevice(db: Db, userId: string, id: string, now = new Date()): boolean {
  return db.update(appToken).set({ revokedAt: now }).where(and(eq(appToken.id, id), eq(appToken.userId, userId), isNull(appToken.revokedAt))).returning({ id: appToken.id }).all().length > 0;
}
