import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encryption of the actors' private keys (#1474): AES-256-GCM, instance key `FEDERATION_KEY_ENC` (32 bytes in base64),
 * modelled on `INVITE_LINK_KEY`. Format: base64url(iv 12 B ‖ tag 16 B ‖ ciphertext). Never change it.
 */
export class FederationKeyError extends Error {}

export function federationKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.FEDERATION_KEY_ENC;
  if (!raw) throw new FederationKeyError('FEDERATION_KEY_ENC manquante (openssl rand -base64 32)');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new FederationKeyError('FEDERATION_KEY_ENC doit faire 32 octets en base64 (openssl rand -base64 32)');
  return key;
}

export function encryptSecret(plain: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', federationKey(env), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}

/** Throws if the key is wrong or the data tampered with: an unreadable private key must never be silently replaced. */
export function decryptSecret(stored: string, env: NodeJS.ProcessEnv = process.env): string {
  const buf = Buffer.from(stored, 'base64url');
  const d = createDecipheriv('aes-256-gcm', federationKey(env), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
