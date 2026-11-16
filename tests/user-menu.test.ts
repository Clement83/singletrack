import { describe, it, expect } from 'vitest';
import { initialOf } from '../src/components/user-menu';

describe('menu utilisateur (#1397)', () => {
  it('avatar = initiale du prénom en capitale', () => {
    expect(initialOf('clément')).toBe('C');
    expect(initialOf('  émilie ')).toBe('É');
    expect(initialOf('')).toBe('?');
  });
});
