import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Accept, Follow, Person, Reject, Undo } from '@fedify/vocab';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { ensureHandle } from '@/lib/federation/handle';
import { upsertRemoteActor } from '@/lib/federation/remote-actors';
import { deliverWithFedify, resolveWithFedify } from '@/lib/federation/friends';
import { listFriends } from '@/lib/friends';

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

type G = typeof globalThis & { __singletrackFederation?: unknown };
const sent: { sender: unknown; to: unknown; activity: unknown }[] = [];
let lookup: (v: unknown) => Promise<unknown>;

beforeEach(() => {
  vi.stubEnv('FEDERATION', 'on');
  vi.stubEnv('BETTER_AUTH_URL', 'https://a.example');
  sent.length = 0;
  (globalThis as G).__singletrackFederation = {
    createContext: () => ({
      getActorUri: (h: string) => new URL(`https://a.example/ap/users/${h}`),
      lookupObject: (v: unknown) => lookup(v),
      sendActivity: async (sender: unknown, to: unknown, activity: unknown) => { sent.push({ sender, to, activity }); },
    }),
  };
});
afterEach(() => { vi.unstubAllEnvs(); delete (globalThis as G).__singletrackFederation; });

const row = (shared: string | null = null) => ({
  id: 'r1', actorUrl: 'https://b.example/ap/users/paul', handle: 'paul', domain: 'b.example', displayName: 'Paul',
  inboxUrl: 'https://b.example/ap/users/paul/inbox', sharedInboxUrl: shared, publicKeyPem: null, fetchedAt: new Date(),
});

describe('envoi Fedify des activités de copains (#1475)', () => {
  it('Follow, et Follow de retour : id /ap/follows/<id>, acteur = moi, objet = le copain', async () => {
    await deliverWithFedify('alice', row(), { t: 'follow', id: 'f1-back' });
    const a = sent[0].activity as Follow;
    expect(a).toBeInstanceOf(Follow);
    expect(a.id?.href).toBe('https://a.example/ap/follows/f1-back');
    expect(a.actorId?.href).toBe('https://a.example/ap/users/alice');
    expect(a.objectId?.href).toBe('https://b.example/ap/users/paul');
    expect(sent[0].sender).toEqual({ identifier: 'alice' });
  });
  it('Accept et Reject portent le Follow reçu ; Undo porte mon Follow ; boîte partagée transmise', async () => {
    await deliverWithFedify('alice', row('https://b.example/ap/inbox'), { t: 'accept', followId: 'https://b.example/ap/follows/x' });
    await deliverWithFedify('alice', row(), { t: 'reject', followId: 'https://b.example/ap/follows/x' });
    await deliverWithFedify('alice', row(), { t: 'undo', followId: 'f1' });
    const [acc, rej, und] = sent.map((s) => s.activity);
    expect(acc).toBeInstanceOf(Accept);
    expect(rej).toBeInstanceOf(Reject);
    expect(und).toBeInstanceOf(Undo);
    expect((acc as Accept).objectId?.href).toBe('https://b.example/ap/follows/x');
    expect((und as Undo).objectId?.href).toBe('https://a.example/ap/follows/f1');
    expect((sent[0].to as { endpoints: { sharedInbox: URL } }).endpoints.sharedInbox.href).toBe('https://b.example/ap/inbox');
  });
});

describe('résolution par adresse (#1475)', () => {
  it('acteur trouvé → ses informations ; introuvable, hors acteur ou erreur → null', async () => {
    lookup = async () => new Person({ id: new URL('https://b.example/ap/users/paul'), preferredUsername: 'paul', name: 'Paul', inbox: new URL('https://b.example/ap/users/paul/inbox') });
    expect(await resolveWithFedify({ handle: 'paul', domain: 'b.example' })).toMatchObject({ actorUrl: 'https://b.example/ap/users/paul', handle: 'paul', displayName: 'Paul', sharedInboxUrl: null });
    lookup = async () => null;
    expect(await resolveWithFedify({ handle: 'paul', domain: 'b.example' })).toBeNull();
    lookup = async () => new Follow({ id: new URL('https://b.example/f') });
    expect(await resolveWithFedify({ handle: 'paul', domain: 'b.example' })).toBeNull();
    lookup = async () => { throw new Error('réseau'); };
    expect(await resolveWithFedify({ handle: 'paul', domain: 'b.example' })).toBeNull();
  });
});

describe('/api/friends avec copains distants (#1475)', () => {
  it('adresse : 422 si fédération coupée ou adresse invalide ; réponse neutre si introuvable ; PATCH / DELETE sur une demande distante', async () => {
    const h = openDb(':memory:');
    state.db = h;
    h.db.insert(user).values({ id: 'u1', name: 'Alice', email: 'a@x.fr' }).run();
    ensureHandle(h.db, 'u1');
    const route = await import('@/app/api/friends/route');
    const byId = await import('@/app/api/friends/[id]/route');
    const post = (body: unknown) => route.POST(new Request('http://x/api/friends', { method: 'POST', body: JSON.stringify(body) }));
    expect(await (await post({ address: 'nimporte' })).json()).toEqual({ error: 'invalidAddress' });
    vi.stubEnv('FEDERATION', 'off');
    expect(await (await post({ address: 'paul@b.example' })).json()).toEqual({ error: 'federationOff' });
    vi.stubEnv('FEDERATION', 'on');
    lookup = async () => null;
    expect((await post({ address: 'paul@b.example' })).status).toBe(202);
    expect(listFriends(h.db, 'u1').outgoing).toEqual([]);

    lookup = async () => new Person({ id: new URL('https://b.example/ap/users/paul'), preferredUsername: 'paul', inbox: new URL('https://b.example/ap/users/paul/inbox') });
    expect((await post({ address: 'paul@b.example' })).status).toBe(202);
    const out = listFriends(h.db, 'u1').outgoing;
    expect(out).toHaveLength(1);
    expect(sent.at(-1)?.activity).toBeInstanceOf(Follow);
    const ctx = { params: Promise.resolve({ id: out[0].id }) };
    expect((await byId.PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ action: 'accept' }) }), ctx)).status).toBe(404); // not the recipient
    expect((await byId.DELETE(new Request('http://x', { method: 'DELETE' }), ctx)).status).toBe(200);
    expect(sent.at(-1)?.activity).toBeInstanceOf(Undo);
    expect(listFriends(h.db, 'u1').outgoing).toEqual([]);
    upsertRemoteActor(h.db, { actorUrl: 'https://b.example/ap/users/paul', handle: 'paul', inboxUrl: 'https://b.example/i' });
  });
});
