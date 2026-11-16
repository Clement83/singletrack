import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Token d'invitation : 32 octets aléatoires (256 bits) en base64url. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Seul le hash est stocké en base. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Chiffrement réversible des liens perso (#1456) : AES-256-GCM, clé `INVITE_LINK_KEY` (32 octets en base64).
 * Le hash reste la clé de recherche ; le chiffré ne sert qu'à réafficher / repartager le lien sans le régénérer.
 * Format stocké : base64url(iv 12 o ‖ tag 16 o ‖ chiffré).
 */
export class InviteKeyError extends Error {}

export function inviteKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.INVITE_LINK_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new InviteKeyError('INVITE_LINK_KEY doit faire 32 octets en base64 (openssl rand -base64 32)');
  return key;
}

/** Au démarrage en production : refuse de tourner sans clé valide. */
export function assertInviteKey(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && !inviteKey(env)) throw new InviteKeyError('INVITE_LINK_KEY manquante (openssl rand -base64 32)');
  inviteKey(env);
}

/** `null` si aucune clé n'est configurée (hors production) : le lien ne sera alors pas réaffichable. */
export function encryptToken(token: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = inviteKey(env);
  if (!key) return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}

/** `null` si pas de valeur, clé absente ou fausse, donnée altérée. */
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

/** Nouveau token d'invitation avec les colonnes à stocker. */
export function newInviteToken(): { token: string; tokenHash: string; tokenEnc: string | null } {
  const token = newToken();
  return { token, tokenHash: hashToken(token), tokenEnc: encryptToken(token) };
}
