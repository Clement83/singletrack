import { describe, expect, it } from 'vitest';
import { openDb } from '@/db';
import { handleHistory, user } from '@/db/schema';
import { backfillHandles, changeHandle, ensureHandle, generateHandle, getHandle, handleBase, isReservedHandle, userIdByHandle } from '@/lib/federation/handle';

const mk = (name = '') => {
  const { db } = openDb(':memory:');
  const add = (id: string, n: string) => db.insert(user).values({ id, name: n, email: `${id}@x.fr` }).run();
  add('u1', name);
  return { db, add };
};

describe('handle fédéré (#1474)', () => {
  it('base : minuscules, accents retirés, caractères exotiques supprimés, 3 caractères minimum', () => {
    expect(handleBase('Clément')).toBe('clement');
    expect(handleBase('Jean-Luc Ö')).toBe('jeanluco');
    expect(handleBase('Zoé')).toBe('zoe');
    expect(handleBase('Al')).toBe('useral');
    expect(handleBase('李')).toBe('user');
    expect(handleBase('x'.repeat(60)).length).toBeLessThanOrEqual(26);
  });

  it('généré depuis le prénom, suffixe numérique au conflit, jamais depuis l’email', () => {
    const { db, add } = mk('Alice');
    expect(ensureHandle(db, 'u1')).toBe('alice');
    add('u2', 'Alice'); add('u3', 'alice');
    expect(ensureHandle(db, 'u2')).toBe('alice2');
    expect(ensureHandle(db, 'u3')).toBe('alice3');
    expect(ensureHandle(db, 'u1')).toBe('alice'); // idempotent
  });

  it('pas de prénom : pas de handle ; il arrive quand le prénom est saisi', () => {
    const { db } = mk('');
    expect(ensureHandle(db, 'u1')).toBeNull();
    db.update(user).set({ name: 'Paul' }).run();
    expect(ensureHandle(db, 'u1')).toBe('paul');
  });

  it('les handles réservés sont évités à la génération', () => {
    const { db } = mk('Admin');
    expect(generateHandle(db, 'Admin')).toBe('admin2');
    expect(isReservedHandle('Singletrack')).toBe(true);
    expect(isReservedHandle('well-known')).toBe(true);
  });

  it('rattrapage des comptes existants', () => {
    const { db, add } = mk('Bob');
    add('u2', '');
    expect(backfillHandles(db)).toBe(1);
    expect(getHandle(db, 'u1').handle).toBe('bob');
    expect(getHandle(db, 'u2').handle).toBeNull();
    expect(userIdByHandle(db, 'BOB')).toBe('u1');
  });

  describe('modification unique', () => {
    it('valide, enregistre, garde l’ancien handle, refuse une deuxième fois', () => {
      const { db } = mk('Alice');
      ensureHandle(db, 'u1');
      expect(getHandle(db, 'u1').canChange).toBe(true);
      expect(changeHandle(db, 'u1', ' Alice_VTT ')).toEqual({ ok: true, handle: 'alice_vtt' });
      expect(db.select().from(handleHistory).all().map((h) => h.handle)).toEqual(['alice']);
      expect(getHandle(db, 'u1').canChange).toBe(false);
      expect(changeHandle(db, 'u1', 'autre')).toEqual({ ok: false, error: 'already_changed' });
    });
    it('refuse invalide, réservé, pris, identique, ancien handle d’un autre', () => {
      const { db, add } = mk('Alice');
      add('u2', 'Bob');
      ensureHandle(db, 'u1'); ensureHandle(db, 'u2');
      for (const bad of ['ab', 'a'.repeat(31), 'avec espace', 'é_é_é', 42, undefined]) expect(changeHandle(db, 'u1', bad), String(bad)).toEqual({ ok: false, error: 'invalid' });
      expect(changeHandle(db, 'u1', 'admin')).toEqual({ ok: false, error: 'reserved' });
      expect(changeHandle(db, 'u1', 'BOB')).toEqual({ ok: false, error: 'taken' });
      expect(changeHandle(db, 'u1', 'alice')).toEqual({ ok: false, error: 'same' });
      expect(changeHandle(db, 'u2', 'bob_v2')).toMatchObject({ ok: true });
      // « bob » est retiré mais appartient toujours à u2 : u1 ne peut pas le prendre.
      expect(changeHandle(db, 'u1', 'bob')).toEqual({ ok: false, error: 'taken' });
      // Et un nouveau compte « Bob » n’hérite pas de « bob ».
      expect(generateHandle(db, 'Bob')).toBe('bob2');
    });
    it('refuse sans handle', () => {
      const { db } = mk('');
      expect(changeHandle(db, 'u1', 'abcdef')).toEqual({ ok: false, error: 'no_handle' });
    });
  });
});
