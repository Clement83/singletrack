import { describe, expect, it } from 'vitest';
import { openDb } from '@/db';
import { actorKey, remoteActor, user } from '@/db/schema';
import { decryptSecret, encryptSecret, federationKey, FederationKeyError } from '@/lib/federation/crypto';
import { getUserKeyPair, publicKeyPem } from '@/lib/federation/keys';
import { getRemoteActor, upsertRemoteActor } from '@/lib/federation/remote-actors';
import { fedAddress, federationEnabled, instanceDomain, publicOrigin } from '@/lib/federation/config';

const KEY = Buffer.alloc(32, 7).toString('base64');
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe('chiffrement des clés d’acteur (#1474)', () => {
  it('aller-retour AES-256-GCM, chiffré différent à chaque fois', () => {
    const e = env({ FEDERATION_KEY_ENC: KEY });
    const a = encryptSecret('secret', e), b = encryptSecret('secret', e);
    expect(a).not.toBe(b);
    expect(a).not.toContain('secret');
    expect(decryptSecret(a, e)).toBe('secret');
  });
  it('clé absente, mauvaise taille, mauvaise clé ou donnée altérée : erreur', () => {
    expect(() => federationKey(env({}))).toThrow(FederationKeyError);
    expect(() => federationKey(env({ FEDERATION_KEY_ENC: 'abc' }))).toThrow(FederationKeyError);
    const enc = encryptSecret('x', env({ FEDERATION_KEY_ENC: KEY }));
    expect(() => decryptSecret(enc, env({ FEDERATION_KEY_ENC: Buffer.alloc(32, 9).toString('base64') }))).toThrow();
    expect(() => decryptSecret(enc.slice(0, -2) + 'AA', env({ FEDERATION_KEY_ENC: KEY }))).toThrow();
  });
});

describe('paire de clés par compte', () => {
  it('générée à la demande, stockée (privée chiffrée), stable ensuite, signe et vérifie', async () => {
    process.env.FEDERATION_KEY_ENC = KEY;
    const { db } = openDb(':memory:');
    db.insert(user).values({ id: 'u1', name: 'A', email: 'a@x.fr' }).run();
    const kp = await getUserKeyPair(db, 'u1');
    const row = db.select().from(actorKey).get()!;
    expect(row.publicPem).toBe(await publicKeyPem(kp.publicKey));
    expect(row.privateEnc).not.toContain('PRIVATE');
    expect(row.privateEnc).not.toContain('BEGIN');
    const kp2 = await getUserKeyPair(db, 'u1');
    expect(await publicKeyPem(kp2.publicKey)).toBe(row.publicPem);
    const data = new TextEncoder().encode('hello');
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp2.privateKey, data);
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', kp.publicKey, sig, data)).toBe(true);
    expect(db.select().from(actorKey).all()).toHaveLength(1);
  });
  it('clé d’instance changée : erreur, la clé publiée n’est pas remplacée', async () => {
    process.env.FEDERATION_KEY_ENC = KEY;
    const { db } = openDb(':memory:');
    db.insert(user).values({ id: 'u1', name: 'A', email: 'a@x.fr' }).run();
    await getUserKeyPair(db, 'u1');
    const before = db.select().from(actorKey).get()!;
    process.env.FEDERATION_KEY_ENC = Buffer.alloc(32, 1).toString('base64');
    await expect(getUserKeyPair(db, 'u1')).rejects.toThrow();
    expect(db.select().from(actorKey).get()).toEqual(before);
    process.env.FEDERATION_KEY_ENC = KEY;
  });
});

describe('cache des acteurs distants', () => {
  it('création puis mise à jour par URL, domaine déduit de l’URL, aucun champ email', () => {
    const { db } = openDb(':memory:');
    const a = upsertRemoteActor(db, { actorUrl: 'https://autre.example/ap/users/paul', handle: 'paul', displayName: 'Paul', inboxUrl: 'https://autre.example/ap/users/paul/inbox' });
    expect(a.domain).toBe('autre.example');
    const b = upsertRemoteActor(db, { actorUrl: 'https://autre.example/ap/users/paul', handle: 'paul', displayName: 'Paulo', inboxUrl: 'https://autre.example/ap/inbox2', publicKeyPem: 'PEM' });
    expect(b.id).toBe(a.id);
    expect(db.select().from(remoteActor).all()).toHaveLength(1);
    expect(getRemoteActor(db, 'https://autre.example/ap/users/paul')).toMatchObject({ displayName: 'Paulo', inboxUrl: 'https://autre.example/ap/inbox2', publicKeyPem: 'PEM' });
    expect(Object.keys(a).join()).not.toMatch(/mail/i);
    expect(getRemoteActor(db, 'https://x.example/inconnu')).toBeNull();
  });
});

describe('configuration de la fédération', () => {
  it('on par défaut dès que la clé existe (#1477), off sans clé, off et on explicites', () => {
    expect(federationEnabled(env({}))).toBe(false); // no key
    expect(federationEnabled(env({ FEDERATION_KEY_ENC: 'abc' }))).toBe(true);
    expect(federationEnabled(env({ FEDERATION: 'off', FEDERATION_KEY_ENC: 'abc' }))).toBe(false);
    expect(federationEnabled(env({ FEDERATION: 'off' }))).toBe(false);
    expect(federationEnabled(env({ FEDERATION: ' ON ' }))).toBe(true);
  });
  it('domaine et adresse depuis la configuration (PUBLIC_URL puis BETTER_AUTH_URL), jamais une requête', () => {
    expect(publicOrigin(env({ BETTER_AUTH_URL: 'https://vtt.example.org/' }))).toBe('https://vtt.example.org');
    expect(instanceDomain(env({ PUBLIC_URL: 'http://localhost:3700', BETTER_AUTH_URL: 'https://x.org' }))).toBe('localhost:3700');
    expect(fedAddress('alice', env({ BETTER_AUTH_URL: 'https://vtt.example.org' }))).toBe('alice@vtt.example.org');
  });
});
