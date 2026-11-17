import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { isPublicPath } from '@/lib/public-routes';

const req = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
const SESSION = 'better-auth.session_token=abc.def';

describe('proxy (#1482)', () => {
  it.each(['/login', '/s/abc', '/t/abc', '/i/tok', '/i/tok/gpx', '/api/health', '/api/auth/get-session', '/api/s/x/join', '/api/t/x/gpx', '/api/i/tok', '/api/locale', '/robots.txt', '/offline'])(
    'route publique %s : passe sans session', async (p) => {
      expect(isPublicPath(p)).toBe(true);
      expect((await proxy(req(p))).headers.get('x-middleware-next')).toBe('1');
    });

  it.each(['/new', '/importer', '/sorties', '/copains', '/styleguide', '/u/x', '/bienvenue'])('page privée %s : redirigée vers /login', async (p) => {
    const res = (await proxy(req(p)));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it('carte des traces / (#1591) : passe sans session, ses voisins restent privés', async () => {
    expect(isPublicPath('/')).toBe(true);
    expect((await proxy(req('/'))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(req('/?t=abc&z=12&lat=43.1&lng=6.1'))).headers.get('x-middleware-next')).toBe('1');
    for (const p of ['/new', '/sorties', '/importer']) expect(isPublicPath(p), p).toBe(false);
  });

  it.each(['/api/tracks/segments', '/api/outings', '/api/outings/x/join', '/api/friends', '/api/profile', '/api/route', '/api/contacts', '/api/inconnue'])(
    'API privée ou inconnue %s : 401 JSON', async (p) => {
      const res = (await proxy(req(p)));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    });

  describe('fédération (#1474)', () => {
    const FED = ['/.well-known/webfinger', '/.well-known/nodeinfo', '/nodeinfo/2.1', '/ap/inbox', '/ap/users/alice', '/ap/users/alice/inbox'];
    it.each(FED)('%s : publique', (p) => expect(isPublicPath(p)).toBe(true));
    it('les voisins ne sont pas publics (/apple, /.well-known/autre, /nodeinfox)', () => {
      for (const p of ['/apple', '/api2', '/.well-known/autre', '/nodeinfox', '/.well-known']) expect(isPublicPath(p), p).toBe(false);
    });
    it.each(FED)('FEDERATION=off : %s répond 404 sans session, rien n’atteint Fedify', async (p) => {
      vi.stubEnv('FEDERATION', 'off');
      const res = await proxy(req(p));
      expect(res.status).toBe(404);
      vi.unstubAllEnvs();
    });
    it('FEDERATION=on, boîte d’entrée (#1477) : activité trop grosse 413, serveur bloqué 403, non signée refusée par Fedify et journalisée', async () => {
      vi.stubEnv('FEDERATION', 'on');
      vi.stubEnv('DATABASE_URL', ':memory:');
      vi.stubEnv('FEDERATION_DB', ':memory:');
      const post = (body: string) => proxy(new NextRequest('http://localhost/ap/inbox', { method: 'POST', headers: { 'content-type': 'application/activity+json' }, body }));
      expect((await post('x'.repeat(300_000))).status).toBe(413);
      const { getDb } = await import('@/db');
      const { blockDomain } = await import('@/lib/federation/moderation');
      blockDomain(getDb().db, 'evil.example');
      expect((await post(JSON.stringify({ type: 'Follow', actor: 'https://evil.example/u/x' }))).status).toBe(403);
      const res = await post(JSON.stringify({ '@context': 'https://www.w3.org/ns/activitystreams', id: 'https://ok.example/a/1', type: 'Follow', actor: 'https://ok.example/u/x', object: 'http://localhost/ap/users/alice' }));
      expect([400, 401]).toContain(res.status);
      vi.unstubAllEnvs();
    });
    it('FEDERATION=on : la requête atteint Fedify avant la redirection /login (pas de 307)', async () => {
      vi.stubEnv('FEDERATION', 'on');
      vi.stubEnv('DATABASE_URL', ':memory:');
      vi.stubEnv('FEDERATION_DB', ':memory:');
      const res = await proxy(new NextRequest('http://localhost/.well-known/webfinger?resource=acct:nobody@localhost', { headers: { accept: 'application/jrd+json' } }));
      expect(res.status).toBe(404); // compte inconnu, répondu par WebFinger (et non une redirection)
      expect(res.headers.get('location')).toBeNull();
      vi.unstubAllEnvs();
    });
  });

  it('un préfixe voisin n’est pas public (/sorties ≠ /s, /api/sx ≠ /api/s, /tx ≠ /t)', () => {
    for (const p of ['/sorties', '/api/sx', '/tx', '/login-admin', '/api/authx', '/api/locale/x', '/ix']) expect(isPublicPath(p), p).toBe(false);
  });

  it('lectures GET de la carte publiques (#1589), écritures et sous-routes privées', async () => {
    for (const p of ['/api/tracks?starts=1', '/api/tracks/geometry?slugs=a', '/api/tracks/un-slug', '/api/outings/map?bbox=1,2,3,4'])
      expect((await proxy(req(p))).headers.get('x-middleware-next'), p).toBe('1');
    for (const [p, method] of [['/api/tracks', 'POST'], ['/api/tracks/un-slug', 'PUT'], ['/api/tracks/un-slug', 'DELETE'], ['/api/tracks/segments', 'GET'], ['/api/tracks/import', 'GET'], ['/api/outings', 'GET'], ['/api/outings/map', 'POST']] as const) {
      const res = await proxy(new NextRequest(`http://localhost${p}`, { method }));
      expect(res.status, `${method} ${p}`).toBe(401);
    }
  });

  it('avec un cookie de session, une route privée passe', async () => {
    expect((await proxy(req('/new', SESSION))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(req('/api/tracks', SESSION))).headers.get('x-middleware-next')).toBe('1');
  });
});
