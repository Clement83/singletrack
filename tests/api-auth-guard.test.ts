import { describe, expect, it, vi } from 'vitest';
import { openDb } from '@/db';
import { isPublicPath } from '@/lib/public-routes';

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
    const handlers = METHODS.filter((m) => typeof mod[m] === 'function');
    expect(handlers.length).toBeGreaterThan(0);
    for (const m of handlers) {
      const req = new Request(`http://localhost${urlPath(file)}`, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' });
      const res = await (mod[m] as (r: Request, c: unknown) => Promise<Response>)(req, { params: Promise.resolve(params) });
      expect(res.status, `${m} ${urlPath(file)}`).toBe(401);
    }
  });
});
