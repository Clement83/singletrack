import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@/db';
import { federationLog, user } from '@/db/schema';
import { listBlockedDomains, LIMITS } from '@/lib/federation/moderation';
import { _resetRateLimit } from '@/lib/outings/rate-limit';
import { upsertRemoteActor } from '@/lib/federation/remote-actors';

const state = vi.hoisted(() => ({ db: undefined as unknown, uid: null as string | null, email: 'a@x.fr' }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => state.db }));
vi.mock('@/lib/current-user', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    assertUser: async () => { if (!state.uid) throw new UnauthorizedError(); return { id: state.uid, email: state.email }; },
    unauthorized: (e: unknown) => { if (e instanceof UnauthorizedError) return Response.json({ error: 'unauthorized' }, { status: 401 }); throw e; },
  };
});

const json = (method: string, body: unknown) => new Request('http://x/api', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  state.db = openDb(':memory:');
  (state.db as { db: { insert: (t: unknown) => { values: (v: unknown) => { run: () => void } } } }).db.insert(user).values({ id: 'u1', name: 'A', email: 'a@x.fr' }).run();
  state.uid = 'u1';
  state.email = 'a@x.fr';
  vi.stubEnv('ADMIN_EMAILS', 'admin@x.fr');
  _resetRateLimit();
});
afterEach(() => vi.unstubAllEnvs());

describe('/api/admin/federation/blocks (#1477)', () => {
  it('401 sans session, 403 pour un compte non admin, rien n’est écrit', async () => {
    const route = await import('@/app/api/admin/federation/blocks/route');
    state.uid = null;
    expect((await route.POST(json('POST', { domain: 'evil.example' }))).status).toBe(401);
    state.uid = 'u1';
    expect((await route.POST(json('POST', { domain: 'evil.example' }))).status).toBe(403);
    expect((await route.DELETE(json('DELETE', { domain: 'evil.example' }))).status).toBe(403);
    expect(listBlockedDomains((state.db as { db: never }).db)).toHaveLength(0);
  });

  it('admin : bloquer, importer, débloquer ; domaine invalide 422', async () => {
    const route = await import('@/app/api/admin/federation/blocks/route');
    state.email = 'ADMIN@x.fr';
    const db = (state.db as { db: Parameters<typeof listBlockedDomains>[0] }).db;
    expect((await route.POST(json('POST', { domain: 'Evil.Example', reason: 'spam' }))).status).toBe(200);
    expect((await route.POST(json('POST', { domain: 'pas un domaine' }))).status).toBe(422);
    const imp = await route.POST(json('POST', { csv: '#domain,#severity\nother.example,suspend\n' }));
    expect(await imp.json()).toMatchObject({ ok: true, added: 1 });
    expect(listBlockedDomains(db).map((b) => b.domain)).toEqual(['evil.example', 'other.example']);
    expect((await route.DELETE(json('DELETE', { domain: 'evil.example' }))).status).toBe(200);
    expect((await route.DELETE(json('DELETE', { domain: 'evil.example' }))).status).toBe(404);
    expect(listBlockedDomains(db).map((b) => b.domain)).toEqual(['other.example']);
  });
});

describe('garde de la boîte d’entrée (#1477)', () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request('https://a.example/ap/users/alice/inbox', { method: 'POST', headers: { 'content-type': 'application/activity+json', ...headers }, body });
  const db = () => (state.db as { db: Parameters<typeof listBlockedDomains>[0] }).db;

  it('isInboxRequest : POST sur les seules boîtes d’entrée', async () => {
    const { isInboxRequest } = await import('@/lib/federation/inbox-guard');
    expect(isInboxRequest({ method: 'POST' }, '/ap/inbox')).toBe(true);
    expect(isInboxRequest({ method: 'POST' }, '/ap/users/alice/inbox')).toBe(true);
    expect(isInboxRequest({ method: 'GET' }, '/ap/inbox')).toBe(false);
    expect(isInboxRequest({ method: 'POST' }, '/ap/users/alice')).toBe(false);
    expect(isInboxRequest({ method: 'POST' }, '/ap/users/a/b/inbox')).toBe(false);
  });

  it('trop grosse : 413 (Content-Length ou corps réel), journalisée ; serveur bloqué : 403 ; corps relu intact sinon', async () => {
    const { guardInbox } = await import('@/lib/federation/inbox-guard');
    const big = 'x'.repeat(LIMITS.maxActivityBytes + 10);
    const g1 = await guardInbox(post(big, { 'content-length': String(big.length) }));
    expect('response' in g1 && g1.response.status).toBe(413);
    const g2 = await guardInbox(post(JSON.stringify({ type: 'Create', actor: 'https://x.example/u', pad: big })));
    expect('response' in g2 && g2.response.status).toBe(413);

    const { blockDomain } = await import('@/lib/federation/moderation');
    blockDomain(db(), 'evil.example');
    const g3 = await guardInbox(post(JSON.stringify({ type: 'Follow', actor: 'https://sub.evil.example/u/x' })));
    expect('response' in g3 && g3.response.status).toBe(403);

    const body = JSON.stringify({ type: 'Follow', actor: 'https://good.example/u/x' });
    const g4 = await guardInbox(post(body));
    expect('request' in g4).toBe(true);
    if ('request' in g4) { expect(await g4.request.text()).toBe(body); expect(g4.domain).toBe('good.example'); }

    const reasons = db().select().from(federationLog).all().map((r: { reason: string }) => r.reason);
    expect(reasons.sort()).toEqual(['blocked', 'too_large', 'too_large']);
  });

  it('Delete d’un acteur inconnu : 202 ; débit : 429 au-delà de 60/min ; refus de signature 401 journalisé', async () => {
    const { guardInbox, logFedifyRefusal } = await import('@/lib/federation/inbox-guard');
    const g = await guardInbox(post(JSON.stringify({ type: 'Delete', actor: 'https://gone.example/u/x' })));
    expect('response' in g && g.response.status).toBe(202);
    upsertRemoteActor(db() as never, { actorUrl: 'https://busy.example/u/x', handle: 'x', inboxUrl: 'https://busy.example/u/x/inbox' });
    let last = 0;
    for (let i = 0; i <= LIMITS.ratePerMinute; i++) {
      const r = await guardInbox(post(JSON.stringify({ type: 'Create', actor: 'https://busy.example/u/x' })));
      last = 'response' in r ? r.response.status : 0;
    }
    expect(last).toBe(429);
    logFedifyRefusal('busy.example', 401);
    logFedifyRefusal('busy.example', 202); // not a rejection
    const reasons = db().select().from(federationLog).all().map((r: { reason: string }) => r.reason);
    expect(reasons).toContain('signature');
    expect(reasons.filter((r: string) => r === 'signature')).toHaveLength(1);
  });
});

describe('isAdmin / assertAdmin (#1737)', () => {
  it('isAdmin: email in ADMIN_EMAILS, case-insensitive, never for visitor or empty list', async () => {
    const { isAdmin } = await import('@/lib/admin');
    vi.stubEnv('ADMIN_EMAILS', 'Admin@X.fr, b@x.fr');
    expect(isAdmin({ email: 'admin@x.fr' })).toBe(true);
    expect(isAdmin({ email: 'B@X.FR' })).toBe(true);
    expect(isAdmin({ email: 'a@x.fr' })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    vi.stubEnv('ADMIN_EMAILS', '');
    expect(isAdmin({ email: 'admin@x.fr' })).toBe(false);
  });
  it('assertAdmin: 401 without session, 403 for a non-admin, user for an admin', async () => {
    const { assertAdmin, adminDenied } = await import('@/lib/admin');
    state.uid = null;
    const e1 = await assertAdmin().catch((e) => e);
    expect(adminDenied(e1).status).toBe(401);
    state.uid = 'u1';
    const e2 = await assertAdmin().catch((e) => e);
    expect(adminDenied(e2).status).toBe(403);
    state.email = 'admin@x.fr';
    expect((await assertAdmin()).id).toBe('u1');
  });
});
