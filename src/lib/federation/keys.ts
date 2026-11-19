import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { actorKey } from '@/db/schema';
import { decryptSecret, encryptSecret } from './crypto';

const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

const toPem = (label: string, der: ArrayBuffer) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END ${label}-----`;
const fromPem = (pem: string) => Buffer.from(pem.replace(/-----[A-Z ]+-----|\s/g, ''), 'base64');

/** SPKI PEM of a public key (cache of remote actors). */
export async function publicKeyPem(key: CryptoKey): Promise<string> {
  return toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', key));
}

/**
 * RSA key pair of an account, generated on first request (#1474). The private key is stored encrypted
 * (FEDERATION_KEY_ENC); an unreadable value throws: a key already published is never replaced.
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
  // Two simultaneous requests: the first one wins, the other reads it back.
  db.insert(actorKey).values({ userId, publicPem, privateEnc }).onConflictDoNothing().run();
  const stored = db.select().from(actorKey).where(eq(actorKey.userId, userId)).get();
  if (stored && stored.publicPem !== publicPem) return getUserKeyPair(db, userId);
  return kp;
}
