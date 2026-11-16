import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { actorKey } from '@/db/schema';
import { decryptSecret, encryptSecret } from './crypto';

const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

const toPem = (label: string, der: ArrayBuffer) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END ${label}-----`;
const fromPem = (pem: string) => Buffer.from(pem.replace(/-----[A-Z ]+-----|\s/g, ''), 'base64');

/** PEM SPKI d'une clé publique (cache des acteurs distants). */
export async function publicKeyPem(key: CryptoKey): Promise<string> {
  return toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', key));
}

/**
 * Paire de clés RSA d'un compte, générée à la première demande (#1474). La clé privée est stockée chiffrée
 * (FEDERATION_KEY_ENC) ; une valeur illisible lève : on ne remplace jamais une clé déjà publiée.
 */
export async function getUserKeyPair(db: Db, userId: string): Promise<CryptoKeyPair> {
  const row = db.select().from(actorKey).where(eq(actorKey.userId, userId)).get();
  if (row) {
    return {
      publicKey: await crypto.subtle.importKey('spki', fromPem(row.publicPem), ALGO, true, ['verify']),
      privateKey: await crypto.subtle.importKey('pkcs8', fromPem(decryptSecret(row.privateEnc)), ALGO, true, ['sign']),
    };
  }
  const kp = (await crypto.subtle.generateKey({ ...ALGO, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicPem = toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', kp.publicKey));
  const privateEnc = encryptSecret(toPem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', kp.privateKey)));
  // Deux requêtes simultanées : la première gagne, l'autre relit.
  db.insert(actorKey).values({ userId, publicPem, privateEnc }).onConflictDoNothing().run();
  const stored = db.select().from(actorKey).where(eq(actorKey.userId, userId)).get();
  if (stored && stored.publicPem !== publicPem) return getUserKeyPair(db, userId);
  return kp;
}
