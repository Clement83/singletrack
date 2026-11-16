import { describe, it, expect } from 'vitest';
import { assertInviteKey, decryptToken, encryptToken, InviteKeyError, newInviteToken, hashToken } from '@/lib/outings/tokens';

const key = (b: number) => ({ INVITE_LINK_KEY: Buffer.alloc(32, b).toString('base64') }) as unknown as NodeJS.ProcessEnv;

describe('chiffrement des liens perso (#1456)', () => {
  it('chiffre puis déchiffre, avec un IV différent à chaque fois', () => {
    const a = encryptToken('abc', key(1))!;
    expect(a).not.toContain('abc');
    expect(decryptToken(a, key(1))).toBe('abc');
    expect(encryptToken('abc', key(1))).not.toBe(a);
  });
  it('mauvaise clé, donnée altérée, valeur vide ⇒ null', () => {
    const a = encryptToken('abc', key(1))!;
    expect(decryptToken(a, key(2))).toBeNull();
    expect(decryptToken(a.slice(0, -2) + 'AA', key(1))).toBeNull();
    expect(decryptToken(null, key(1))).toBeNull();
    expect(decryptToken(a, {} as NodeJS.ProcessEnv)).toBeNull();
  });
  it('clé absente : pas de chiffré ; refusée en production ; longueur invalide refusée', () => {
    expect(encryptToken('abc', {} as NodeJS.ProcessEnv)).toBeNull();
    expect(() => assertInviteKey({ NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv)).toThrow(InviteKeyError);
    expect(() => assertInviteKey({} as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertInviteKey({ INVITE_LINK_KEY: 'court' } as unknown as NodeJS.ProcessEnv)).toThrow(InviteKeyError);
  });
  it('newInviteToken : hash + chiffré cohérents', () => {
    const t = newInviteToken();
    expect(t.tokenHash).toBe(hashToken(t.token));
    expect(decryptToken(t.tokenEnc)).toBe(t.token);
  });
});
