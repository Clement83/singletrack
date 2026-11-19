import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Invitation token: 32 random bytes (256 bits) in base64url. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only the hash is stored in the database. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Reversible encryption of personal links (#1456): AES-256-GCM, key `INVITE_LINK_KEY` (32 bytes in base64).
 * The hash stays the lookup key; the ciphertext is only used to show / share the link again without regenerating it.
 * Stored format: base64url(iv 12 B ‖ tag 16 B ‖ ciphertext).
 */
export class InviteKeyError extends Error {}

export function inviteKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.INVITE_LINK_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new InviteKeyError('INVITE_LINK_KEY doit faire 32 octets en base64 (openssl rand -base64 32)');
  return key;
}

/** At start-up in production: refuses to run without a valid key. */
export function assertInviteKey(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && !inviteKey(env)) throw new InviteKeyError('INVITE_LINK_KEY manquante (openssl rand -base64 32)');
  inviteKey(env);
}

/** `null` if no key is configured (outside production): the link will then not be shown again. */
export function encryptToken(token: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = inviteKey(env);
  if (!key) return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}

/** `null` if no value, key missing or wrong, tampered data. */
export function decryptToken(stored: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!stored) return null;
  try {
    const key = inviteKey(env);
    if (!key) return null;
    const buf = Buffer.from(stored, 'base64url');
    const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** New invitation token with the columns to store. */
export function newInviteToken(): { token: string; tokenHash: string; tokenEnc: string | null } {
  const token = newToken();
  return { token, tokenHash: hashToken(token), tokenEnc: encryptToken(token) };
}
