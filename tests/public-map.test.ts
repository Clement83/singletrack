import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/safe-next';
import { loginHref } from '@/lib/login-href';

// #1591 : carte publique, retour sur la même vue après connexion, sans redirection ouverte.
describe('retour après connexion vers la carte (#1591)', () => {
  it('safeNext accepte la carte et sa vue', () => {
    expect(safeNext('/')).toBe('/');
    expect(safeNext('/?t=0b6f-aa&z=12.5&lat=43.1234&lng=6.1234')).toBe('/?t=0b6f-aa&z=12.5&lat=43.1234&lng=6.1234');
    expect(safeNext('/?q=col+du+fer&difficulty=blue')).toBe('/?q=col+du+fer&difficulty=blue');
  });
  it.each(['//evil.fr', '/\\evil.fr', '/sorties?t=1', '/new?z=1', 'https://evil.fr/?t=1', '/?a-b=1', `/?q=${'a'.repeat(1000)}`, '/#t=1', '/x'])('safeNext refuse %s', (v) => {
    expect(safeNext(v)).toBeUndefined();
  });
  it('loginHref : la carte revient avec sa vue, toute autre page sur /login nu', () => {
    expect(loginHref({ pathname: '/', search: '?t=ab12&z=12&lat=43.1&lng=6.1' })).toBe(`/login?next=${encodeURIComponent('/?t=ab12&z=12&lat=43.1&lng=6.1')}`);
    expect(loginHref({ pathname: '/', search: '' })).toBe(`/login?next=${encodeURIComponent('/')}`);
    expect(loginHref({ pathname: '/t/abc', search: '' })).toBe('/login');
  });
});
