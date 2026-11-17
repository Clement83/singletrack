import { describe, expect, it, vi } from 'vitest';
import { openDb } from '@/db';
import { isPublicPath, isPublicRead } from '@/lib/public-routes';

// Aucune session : toute route d'écriture/lecture privée de /api doit répondre 401 (#1482).
const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => state.db }));
vi.mock('@/lib/current-user', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    getCurrentUser: async () => null,
    assertUser: async () => { throw new UnauthorizedError(); },
    requireUser: async () => { throw new UnauthorizedError(); },
    unauthorized: (e: unknown) => {
      if (e instanceof UnauthorizedError) return Response.json({ error: 'unauthorized' }, { status: 401 });
      throw e;
    },
  };
});

const modules = import.meta.glob('../src/app/api/**/route.ts');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const urlPath = (file: string) =>
  file.replace('../src/app', '').replace('/route.ts', '').replace(/\[\.\.\.\w+\]/g, 'x').replace(/\[\w+\]/g, 'x');
const params = new Proxy({}, { get: () => 'x' });

describe('routes /api : liste blanche et garde de session', () => {
  it('trouve bien les route handlers', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(40);
  });

  const privateRoutes = Object.keys(modules).filter((f) => !isPublicPath(urlPath(f)));
  it('il existe des routes privées', () => expect(privateRoutes.length).toBeGreaterThan(30));

  it.each(privateRoutes)('%s : 401 sans session, quelle que soit la méthode', async (file) => {
    state.db = openDb(':memory:');
    const mod = (await modules[file]()) as Record<string, unknown>;
    // Lectures GET publiques de la carte (#1589) : exceptions listées dans public-routes.ts, vérifiées plus bas.
    const handlers = METHODS.filter((m) => typeof mod[m] === 'function' && !isPublicRead(urlPath(file), m));
    if (!handlers.length) return expect(isPublicRead(urlPath(file), 'GET')).toBe(true); // seulement des lectures publiques
    for (const m of handlers) {
      const req = new Request(`http://localhost${urlPath(file)}`, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' });
      const res = await (mod[m] as (r: Request, c: unknown) => Promise<Response>)(req, { params: Promise.resolve(params) });
      expect(res.status, `${m} ${urlPath(file)}`).toBe(401);
    }
  });

  // Exceptions publiques en lecture (#1589), justifiées une par une : chaque route filtre par visibilité (anonyme = public seul).
  const PUBLIC_READS = ['/api/tracks', '/api/tracks/geometry', '/api/tracks/x', '/api/outings/map'];
  it('les seules lectures GET publiques de /api/tracks et /api/outings sont celles de la carte', () => {
    const all = Object.keys(modules).map(urlPath).filter((p) => isPublicRead(p, 'GET'));
    expect(all.sort()).toEqual([...PUBLIC_READS].sort());
    for (const p of PUBLIC_READS) {
      expect(isPublicRead(p, 'POST'), p).toBe(false);
      expect(isPublicRead(p, 'PUT'), p).toBe(false);
      expect(isPublicRead(p, 'DELETE'), p).toBe(false);
    }
    for (const p of ['/api/tracks/segments', '/api/tracks/import', '/api/tracks/a/b', '/api/outings', '/api/outings/x']) expect(isPublicRead(p, 'GET'), p).toBe(false);
  });

  it('GET /api/tracks sans session : seulement ?starts=1 (sinon 401), jamais mine=1', async () => {
    state.db = openDb(':memory:');
    const mod = (await modules['../src/app/api/tracks/route.ts']()) as { GET: (r: Request) => Promise<Response> };
    expect((await mod.GET(new Request('http://localhost/api/tracks?starts=1'))).status).toBe(200);
    expect((await mod.GET(new Request('http://localhost/api/tracks'))).status).toBe(401);
    expect((await mod.GET(new Request('http://localhost/api/tracks?starts=1&mine=1'))).status).toBe(401);
  });
});
