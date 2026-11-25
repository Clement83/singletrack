import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Person } from '@fedify/vocab';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { ensureHandle } from '@/lib/federation/handle';

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => state.db }));

const ORIGIN = 'https://vtt.example.org';
let tmp: string;
let fed: Awaited<ReturnType<typeof setup>>;

async function setup() {
  process.env.FEDERATION_KEY_ENC = Buffer.alloc(32, 3).toString('base64');
  const handle = openDb(':memory:');
  state.db = handle;
  handle.db.insert(user).values({ id: 'u1', name: 'Alice', email: 'secret-alice@mail.test', profileVisibility: 'private' }).run();
  ensureHandle(handle.db, 'u1');
  const { buildFederation } = await import('@/lib/federation');
  const dbFile = path.join(tmp, 'federation.db');
  const federation = buildFederation({ dbFile, origin: ORIGIN, startQueue: false });
  return { ...handle, federation, dbFile };
}
const get = (url: string, accept: string) => fed.federation.fetch(new Request(url, { headers: { accept } }), { contextData: undefined });

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fed-'));
  fed = await setup();
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('Fedify : identité (#1474)', () => {
  it('WebFinger : acct:handle@domaine → lien self vers l’acteur, insensible à la casse', async () => {
    const res = await get(`${ORIGIN}/.well-known/webfinger?resource=acct:Alice@vtt.example.org`, 'application/jrd+json');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(String(body.subject).toLowerCase()).toBe('acct:alice@vtt.example.org');
    expect(body.links.find((l: { rel: string }) => l.rel === 'self').href).toBe(`${ORIGIN}/ap/users/alice`);
    expect(JSON.stringify(body)).not.toContain('secret-alice');
  });
  it('WebFinger : compte inconnu → 404', async () => {
    expect((await get(`${ORIGIN}/.well-known/webfinger?resource=acct:zorro@vtt.example.org`, 'application/jrd+json')).status).toBe(404);
  });
  it('l’origine vient de la configuration, pas de l’hôte de la requête', async () => {
    const res = await get('http://0.0.0.0:3000/ap/users/alice', 'application/activity+json');
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(`${ORIGIN}/ap/users/alice`);
  });
  it('acteur Person : handle, prénom, inbox, outbox, followers, following, clé publique ; ni email ni stats', async () => {
    const res = await get(`${ORIGIN}/ap/users/alice`, 'application/activity+json');
    expect(res.status).toBe(200);
    const a = await res.json();
    expect(a.type).toBe('Person');
    expect(a.preferredUsername).toBe('alice');
    expect(a.name).toBe('Alice');
    expect(a.inbox).toBe(`${ORIGIN}/ap/users/alice/inbox`);
    expect(a.outbox).toBe(`${ORIGIN}/ap/users/alice/outbox`);
    expect(a.followers).toBe(`${ORIGIN}/ap/users/alice/followers`);
    expect(a.following).toBe(`${ORIGIN}/ap/users/alice/following`);
    expect(a.endpoints.sharedInbox).toBe(`${ORIGIN}/ap/inbox`);
    expect(a.publicKey.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(a)).not.toMatch(/secret-alice|mail\.test|summary/);
  });
  it('acteur inconnu → 404', async () => {
    expect((await get(`${ORIGIN}/ap/users/zorro`, 'application/activity+json')).status).toBe(404);
  });
  it('NodeInfo : /.well-known/nodeinfo puis /nodeinfo/2.1 (singletrack, activitypub)', async () => {
    const idx = await (await get(`${ORIGIN}/.well-known/nodeinfo`, 'application/json')).json();
    expect(idx.links[0].href).toBe(`${ORIGIN}/nodeinfo/2.1`);
    const ni = await (await get(`${ORIGIN}/nodeinfo/2.1`, 'application/json')).json();
    expect(ni.software.name).toBe('singletrack');
    expect(ni.protocols).toEqual(['activitypub']);
    expect(ni.usage.users.total).toBe(1);
    expect(typeof ni.openRegistrations).toBe('boolean');
    // #1775: other singletrack servers send ridden tracks only to a server announcing it.
    const { announcesRides } = await import('@/lib/federation/rides');
    expect(ni.metadata.features).toContain('singletrack:rides');
    expect(announcesRides(ni)).toBe(true);
    expect(announcesRides({ metadata: {} })).toBe(false);
  });
  it('trace roulée /ap/rides/<id> : requête non signée ou inconnue → 404 (#1775)', async () => {
    expect((await get(`${ORIGIN}/ap/rides/00000000-0000-4000-8000-000000000000`, 'application/activity+json')).status).toBe(404);
  });
  it('boîte d’entrée : un POST sans signature valide est refusé', async () => {
    const res = await fed.federation.fetch(
      new Request(`${ORIGIN}/ap/inbox`, { method: 'POST', headers: { 'content-type': 'application/activity+json' }, body: JSON.stringify({ '@context': 'https://www.w3.org/ns/activitystreams', id: 'https://evil.example/a/1', type: 'Follow', actor: 'https://evil.example/u/x', object: `${ORIGIN}/ap/users/alice` }) }),
      { contextData: undefined },
    );
    expect([400, 401]).toContain(res.status);
  });
});

describe('Fedify : file d’envoi persistante (#1474)', () => {
  it('une activité à envoyer est écrite dans la file SQLite (survit à un redémarrage) ; réessais ~48 h', async () => {
    const ctx = fed.federation.createContext(new URL(ORIGIN), undefined);
    const { Follow } = await import('@fedify/vocab');
    const remote = new Person({ id: new URL('https://autre.example/ap/users/paul'), preferredUsername: 'paul', inbox: new URL('https://autre.example/ap/users/paul/inbox') });
    await ctx.sendActivity({ identifier: 'alice' }, remote, new Follow({ id: new URL(`${ORIGIN}/ap/follows/1`), actor: ctx.getActorUri('alice'), object: remote.id }));
    const reopened = new DatabaseSync(fed.dbFile);
    const n = (reopened.prepare('select count(*) n from fedify_message').get() as { n: number }).n;
    reopened.close();
    expect(n).toBeGreaterThanOrEqual(1);
  });
  it('politique de réessai : exponentielle, plafonnée à 8 h, abandon après ~48 h', async () => {
    const { retryPolicy } = await import('@/lib/federation');
    const delays: number[] = [];
    for (let attempts = 0; attempts < 20; attempts++) {
      const d = retryPolicy({ attempts, elapsedTime: undefined as never, error: new Error('x') } as never);
      if (!d) break;
      delays.push(d.total({ unit: 'minutes' }));
    }
    expect(delays.length).toBeLessThanOrEqual(14);
    expect(delays.length).toBeGreaterThanOrEqual(13);
    expect(Math.max(...delays)).toBeLessThanOrEqual(10 * 60);
    const hours = delays.reduce((a, b) => a + b, 0) / 60;
    expect(hours).toBeGreaterThan(36);
    expect(hours).toBeLessThan(62);
  });
});
