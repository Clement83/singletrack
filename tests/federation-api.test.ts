import { describe, expect, it, vi } from 'vitest';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { createAuth } from '@/lib/auth';
import { createUser } from '@/lib/users';
import { getHandle } from '@/lib/federation/handle';

const state = vi.hoisted(() => ({ db: undefined as unknown, uid: 'u1' as string | null }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => state.db }));
vi.mock('@/lib/current-user', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    assertUser: async () => { if (!state.uid) throw new UnauthorizedError(); return { id: state.uid }; },
    unauthorized: (e: unknown) => { if (e instanceof UnauthorizedError) return Response.json({ error: 'unauthorized' }, { status: 401 }); throw e; },
  };
});

const put = (route: typeof import('@/app/api/profile/handle/route'), handle: unknown) =>
  route.PUT(new Request('http://x/api/profile/handle', { method: 'PUT', body: JSON.stringify({ handle }) }));

describe('/api/profile/handle (#1474)', () => {
  it('401 sans session', async () => {
    const route = await import('@/app/api/profile/handle/route');
    state.uid = null;
    expect((await route.GET()).status).toBe(401);
    expect((await put(route, 'abcdef')).status).toBe(401);
    state.uid = 'u1';
  });
  it('GET puis PUT unique : 200, puis 409 ; invalide 400 ; adresse seulement si la fédération est active', async () => {
    const route = await import('@/app/api/profile/handle/route');
    const h = openDb(':memory:');
    state.db = h;
    h.db.insert(user).values({ id: 'u1', name: 'Alice', email: 'a@x.fr', handle: 'alice' }).run();
    vi.stubEnv('FEDERATION', 'off');
    expect(await (await route.GET()).json()).toEqual({ handle: 'alice', address: null, canChange: true });
    vi.stubEnv('FEDERATION', 'on');
    vi.stubEnv('BETTER_AUTH_URL', 'https://vtt.example.org');
    expect(await (await route.GET()).json()).toEqual({ handle: 'alice', address: 'alice@vtt.example.org', canChange: true });
    expect((await put(route, 'x')).status).toBe(400);
    expect((await put(route, 'admin')).status).toBe(400);
    const ok = await put(route, 'alice_vtt');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ handle: 'alice_vtt', address: 'alice_vtt@vtt.example.org', canChange: false });
    expect((await put(route, 'autre_nom')).status).toBe(409);
    vi.unstubAllEnvs();
  });
});

describe('handle à la création du compte (#1474)', () => {
  it('compte créé avec un prénom : handle immédiat ; prénom saisi plus tard : handle à ce moment', async () => {
    const { db } = openDb(':memory:');
    const auth = createAuth(db, { mailer: async () => {} });
    const u = await createUser(auth, { email: 'zoe@x.fr', name: 'Zoé' });
    expect(getHandle(db, u.id).handle).toBe('zoe');
    const ctx = await auth.$context;
    const v = await ctx.internalAdapter.createUser({ email: 'paul@x.fr', name: '', emailVerified: true }, { method: 'admin' });
    expect(getHandle(db, v.id).handle).toBeNull();
    await ctx.internalAdapter.updateUser(v.id, { name: 'Paul' } as never);
    expect(getHandle(db, v.id).handle).toBe('paul');
  });
});
