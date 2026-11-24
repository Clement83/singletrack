import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { catalogRegion, parseBbox, REGION_CATALOG, segmentsForBbox } from '@/lib/offline/regions';
import { addRegion, deleteRegion, getRegion, listRegions, packsEnabled, recordBuild, setAdminSwitch, setRegionEnabled } from '@/lib/offline/store';

const state = vi.hoisted(() => ({ db: undefined as unknown, uid: null as string | null, email: 'a@x.fr' }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => state.db }));
vi.mock('@/lib/current-user', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, assertUser: async () => { if (!state.uid) throw new UnauthorizedError(); return { id: state.uid, email: state.email }; } };
});

let dir: string;
beforeEach(() => {
  state.db = openDb(':memory:');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-'));
  vi.stubEnv('OFFLINE_DIR', dir);
  vi.stubEnv('ADMIN_EMAILS', 'admin@x.fr');
  state.uid = 'u1'; state.email = 'a@x.fr';
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });
const db = () => (state.db as { db: ReturnType<typeof openDb>['db'] }).db;

describe('catalogue and segments', () => {
  it('catalogue ids are unique and bboxes valid', () => {
    expect(new Set(REGION_CATALOG.map((r) => r.id)).size).toBe(REGION_CATALOG.length);
    for (const r of REGION_CATALOG) expect(parseBbox(r.bbox)).toEqual(r.bbox);
  });
  it('maps a bbox to 5° BRouter tiles', () => {
    expect(segmentsForBbox(catalogRegion('paca')!.bbox)).toEqual(['W5_N40'.replace('W5','E0'), 'E5_N40', 'E0_N45', 'E5_N45']);
    expect(segmentsForBbox([-1.8, 47, 2, 48])).toEqual(['W5_N45', 'E0_N45']);
    expect(segmentsForBbox([5.5, 43, 6, 44])).toEqual(['E5_N40']);
  });
  it('rejects invalid bboxes', () => {
    expect(parseBbox('1,2,0,3')).toBeNull();
    expect(parseBbox('a,b,c,d')).toBeNull();
    expect(parseBbox('-100,0,100,10')).toBeNull();
    expect(parseBbox('4.2, 43, 7.7, 45')).toEqual([4.2, 43, 7.7, 45]);
  });
});

describe('store', () => {
  it('adds, builds, enables and deletes a region (file removed)', () => {
    const r = addRegion(db(), { catalog: 'paca' });
    expect('region' in r && r.region.segments.length).toBeGreaterThan(0);
    expect(addRegion(db(), { catalog: 'paca' })).toEqual({ error: 'exists' });
    expect(setRegionEnabled(db(), 'paca', true)).toBe('not_built');
    const file = path.join(dir, 'paca.pmtiles');
    fs.writeFileSync(file, 'x');
    recordBuild(db(), 'paca', { pmtilesPath: file, sizeBytes: 1, version: '20261124', segments: ['E5_N40'] });
    expect(setRegionEnabled(db(), 'paca', true)).toBe('ok');
    expect(listRegions(db())[0]).toMatchObject({ enabled: true, sizeBytes: 1, built: true });
    expect(deleteRegion(db(), 'paca')).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(getRegion(db(), 'paca')).toBeNull();
  });
  it('custom region needs a name and a valid bbox', () => {
    expect(addRegion(db(), { name: 'Massif Central', bbox: '2,44,4,46' })).toMatchObject({ region: { id: 'massif-central' } });
    expect(addRegion(db(), { name: 'x', bbox: 'nope' })).toEqual({ error: 'invalid' });
    expect(addRegion(db(), { catalog: 'atlantis' })).toEqual({ error: 'invalid' });
  });
  it('master switch needs env AND admin setting', () => {
    expect(packsEnabled(db())).toBe(false);
    vi.stubEnv('OFFLINE_PACKS_ENABLED', 'true');
    expect(packsEnabled(db())).toBe(true);
    setAdminSwitch(db(), false);
    expect(packsEnabled(db())).toBe(false);
  });
});

describe('/api/admin/offline rights', () => {
  it('401 without session, 403 for non-admin, ok for admin', async () => {
    db().insert(user).values({ id: 'u1', name: 'A', email: 'a@x.fr' }).run();
    const { POST, PATCH, DELETE } = await import('@/app/api/admin/offline/route');
    const req = (method: string, body: unknown) => new Request('http://x/api', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    state.uid = null;
    expect((await POST(req('POST', { catalog: 'paca' }))).status).toBe(401);
    state.uid = 'u1';
    expect((await POST(req('POST', { catalog: 'paca' }))).status).toBe(403);
    expect((await PATCH(req('PATCH', { switch: false }))).status).toBe(403);
    expect((await DELETE(req('DELETE', { id: 'paca' }))).status).toBe(403);
    state.email = 'admin@x.fr';
    expect((await POST(req('POST', { catalog: 'paca' }))).status).toBe(200);
    expect((await PATCH(req('PATCH', { id: 'paca', enabled: true }))).status).toBe(409);
    expect((await DELETE(req('DELETE', { id: 'paca' }))).status).toBe(200);
  });
});
