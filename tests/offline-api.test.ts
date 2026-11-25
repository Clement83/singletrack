import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@/db';
import { offlineUsage, user } from '@/db/schema';
import { createPairing, exchangePairing } from '@/lib/app/tokens';
import { addRegion, recordBuild, setAdminSwitch, setRegionEnabled } from '@/lib/offline/store';
import { usageSummary } from '@/lib/offline/serve';
import { _resetRateLimit } from '@/lib/outings/rate-limit';

const st = vi.hoisted(() => ({ h: undefined as unknown }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => st.h }));

import * as catalog from '@/app/api/app/offline/route';
import * as file from '@/app/api/app/offline/[file]/route';
import * as seg from '@/app/api/app/offline/segments/[name]/route';

const db = () => (st.h as ReturnType<typeof openDb>).db;
const ctx = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const req = (url: string, token: string | null, headers: Record<string, string> = {}) =>
  new Request(`http://x${url}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

let dir: string, segDir: string, token: string;
const PM = Buffer.from('0123456789abcdefghij');
const RD5 = Buffer.from('segment-data-segment-data');

beforeEach(() => {
  _resetRateLimit();
  st.h = openDb(':memory:');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offapi-'));
  segDir = path.join(dir, 'segs');
  fs.mkdirSync(segDir);
  vi.stubEnv('OFFLINE_DIR', dir);
  vi.stubEnv('BROUTER_SEGMENTS_DIR', segDir);
  vi.stubEnv('OFFLINE_PACKS_ENABLED', 'on');
  vi.stubEnv('BETTER_AUTH_URL', '');
  const now = new Date();
  db().insert(user).values({ id: 'a', name: 'A', email: 'a@x.fr', emailVerified: true, createdAt: now, updatedAt: now }).run();
  const r = exchangePairing(db(), createPairing(db(), 'a').code, 'Pixel');
  if (!r.ok) throw new Error('pair');
  token = r.token;
  const added = addRegion(db(), { catalog: 'paca' });
  if (!('region' in added)) throw new Error('add');
  fs.writeFileSync(path.join(dir, 'paca.pmtiles'), PM);
  recordBuild(db(), 'paca', { pmtilesPath: path.join(dir, 'paca.pmtiles'), sizeBytes: PM.length, version: '20261101', segments: ['E5_N40', 'E5_N45'] });
  fs.writeFileSync(path.join(segDir, 'E5_N40.rd5'), RD5);
  fs.writeFileSync(path.join(segDir, 'E10_N45.rd5'), RD5); // exists but outside any region
  setRegionEnabled(db(), 'paca', true);
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });

const getFile = (f: string, headers?: Record<string, string>, t: string | null = token) => file.GET(req(`/api/app/offline/${f}`, t, headers), ctx({ file: f }));
const getSeg = (n: string, headers?: Record<string, string>, t: string | null = token) => seg.GET(req(`/api/app/offline/segments/${n}`, t, headers), ctx({ name: n }));

describe('offline API (#1739)', () => {
  it('401 without token on every route', async () => {
    expect((await catalog.GET(req('/api/app/offline', null), ctx({}))).status).toBe(401);
    expect((await getFile('paca.pmtiles', { range: 'bytes=0-3' }, null)).status).toBe(401);
    expect((await getSeg('E5_N40.rd5', {}, null)).status).toBe(401);
    expect((await getFile('style.json', {}, null)).status).toBe(401);
  });

  it('catalogue lists active regions with existing segments and sha256', async () => {
    const body = await (await catalog.GET(req('/api/app/offline', token), ctx({}))).json();
    expect(body.enabled).toBe(true);
    expect(body.regions).toHaveLength(1);
    expect(body.regions[0]).toMatchObject({ id: 'paca', pmtilesSize: PM.length, version: '20261101' });
    expect(body.regions[0].segments).toEqual([{ name: 'E5_N40', size: RD5.length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(body.style).toBe('http://x/api/app/offline/style.json');
  });

  it('catalogue and style use the public origin, not the request origin (#1771)', async () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://st.example/');
    const body = await (await catalog.GET(req('/api/app/offline', token), ctx({}))).json();
    expect(body.style).toBe('https://st.example/api/app/offline/style.json');
    const s = await (await file.GET(req('/api/app/offline/style.json?region=paca', token), ctx({ file: 'style.json' }))).json();
    expect(s.sources.protomaps.url).toBe('pmtiles://https://st.example/api/app/offline/paca.pmtiles');
  });

  it('a disabled region is not listed and its files are 404', async () => {
    setRegionEnabled(db(), 'paca', false);
    expect((await (await catalog.GET(req('/api/app/offline', token), ctx({}))).json()).regions).toEqual([]);
    expect((await getFile('paca.pmtiles', { range: 'bytes=0-3' })).status).toBe(404);
    expect((await getSeg('E5_N40.rd5')).status).toBe(404);
  });

  it('master switch off: enabled=false and 404 on files', async () => {
    setAdminSwitch(db(), false);
    expect((await (await catalog.GET(req('/api/app/offline', token), ctx({}))).json())).toMatchObject({ enabled: false, regions: [] });
    expect((await getFile('paca.pmtiles', { range: 'bytes=0-3' })).status).toBe(404);
    expect((await getFile('style.json')).status).toBe(404);
    vi.stubEnv('OFFLINE_PACKS_ENABLED', 'off');
    setAdminSwitch(db(), true);
    expect((await getSeg('E5_N40.rd5')).status).toBe(404);
  });

  it('pmtiles: Range required, 206 with Content-Range and ETag', async () => {
    expect((await getFile('paca.pmtiles')).status).toBe(416);
    const r = await getFile('paca.pmtiles', { range: 'bytes=2-5' });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes 2-5/${PM.length}`);
    expect(r.headers.get('etag')).toBe('"20261101"');
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe('2345');
    expect((await getFile('paca.pmtiles', { range: 'bytes=999-' })).status).toBe(416);
    expect((await getFile('unknown.pmtiles', { range: 'bytes=0-1' })).status).toBe(404);
  });

  it('segments: full download, resume with Range, outside a region ⇒ 404', async () => {
    const full = await getSeg('E5_N40.rd5');
    expect(full.status).toBe(200);
    expect(Buffer.from(await full.arrayBuffer()).equals(RD5)).toBe(true);
    const part = await getSeg('E5_N40.rd5', { range: 'bytes=10-' });
    expect(part.status).toBe(206);
    expect(Buffer.from(await part.arrayBuffer()).equals(RD5.subarray(10))).toBe(true);
    expect((await getSeg('E10_N45.rd5')).status).toBe(404); // file exists, no active region lists it
    expect((await getSeg('E5_N45.rd5')).status).toBe(404); // listed but absent from disk
    expect((await getSeg('..%2Fx.rd5')).status).toBe(404);
  });

  it('style.json is a MapLibre style on the region archive', async () => {
    const s = await (await getFile('style.json')).json();
    expect(s.version).toBe(8);
    expect(s.sources.protomaps.url).toMatch(/^pmtiles:\/\//);
    expect(s.sources.dem.encoding).toBe('terrarium');
    const withRegion = await (await file.GET(req('/api/app/offline/style.json?region=paca', token), ctx({ file: 'style.json' }))).json();
    expect(withRegion.sources.protomaps.url).toBe('pmtiles://http://x/api/app/offline/paca.pmtiles');
  });

  it('logs served bytes and throttles beyond the daily quota', async () => {
    await (await getSeg('E5_N40.rd5')).arrayBuffer();
    await (await getFile('paca.pmtiles', { range: 'bytes=0-3' })).arrayBuffer();
    expect(db().select().from(offlineUsage).all().map((u) => u.bytes).sort()).toEqual([4, RD5.length].sort());
    expect(usageSummary(db())[0]).toMatchObject({ userId: 'a', bytes: 4 + RD5.length, requests: 2 });
    db().insert(offlineUsage).values({ tokenId: db().select().from(offlineUsage).get()!.tokenId, userId: 'a', kind: 'segment', name: 'x', bytes: 25_000_000_000 }).run();
    const r = await getSeg('E5_N40.rd5');
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
  });

  it('rate limits the number of requests per token', async () => {
    let last = 200;
    for (let i = 0; i < 601; i++) last = (await catalog.GET(req('/api/app/offline', token), ctx({}))).status;
    expect(last).toBe(429);
  });
});
