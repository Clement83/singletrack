import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@/db';
import { offlineJob, user } from '@/db/schema';
import { claimNextJob, enqueueJob, finishJob, latestJobs, recoverJobs, workerAlive, workerHeartbeat, WORKER_STALE_MS } from '@/lib/offline/jobs';
import { runJob, workerTick } from '@/lib/offline/worker';
import { runRefresh } from '@/lib/offline/build';
import { getLastRefresh } from '@/lib/offline/refresh';
import { addRegion, getRegion, setRegionEnabled } from '@/lib/offline/store';

// #1749: job queue of the offline-worker service, job runner, admin API.
const state = vi.hoisted(() => ({ db: undefined as unknown, uid: null as string | null, email: 'admin@x.fr' }));
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => state.db }));
vi.mock('@/lib/current-user', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, assertUser: async () => { if (!state.uid) throw new UnauthorizedError(); return { id: state.uid, email: state.email }; } };
});

let dir: string;
beforeEach(() => {
  state.db = openDb(':memory:');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-jobs-'));
  vi.stubEnv('OFFLINE_DIR', path.join(dir, 'offline'));
  vi.stubEnv('BROUTER_SEGMENTS_DIR', path.join(dir, 'segments'));
  vi.stubEnv('ADMIN_EMAILS', 'admin@x.fr');
  state.uid = 'u1'; state.email = 'admin@x.fr';
  db().insert(user).values({ id: 'u1', name: 'A', email: 'admin@x.fr' }).run();
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });
const db = () => (state.db as { db: ReturnType<typeof openDb>['db'] }).db;

const extract = vi.fn(async (_source: string, out: string) => { fs.writeFileSync(out, 'pmtiles-data'); });
const fetchSegment = vi.fn(async (d: string, name: string) => { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `${name}.rd5`), 'rd5'); return 'updated' as const; });
const deps = { source: 'https://x/20261101.pmtiles', extract, fetchSegment };

describe('job queue', () => {
  it('enqueue refuses unknown regions and duplicates while queued or running', () => {
    expect(enqueueJob(db(), { kind: 'build', regionId: 'paca' })).toEqual({ error: 'not_found' });
    addRegion(db(), { catalog: 'paca' });
    expect(enqueueJob(db(), { kind: 'build', regionId: 'paca' })).toHaveProperty('job');
    expect(enqueueJob(db(), { kind: 'build', regionId: 'paca' })).toEqual({ error: 'busy' });
    expect(enqueueJob(db(), { kind: 'refresh' })).toHaveProperty('job');
    expect(enqueueJob(db(), { kind: 'refresh' })).toEqual({ error: 'busy' });
    const j = claimNextJob(db())!;
    expect(j).toMatchObject({ kind: 'build', regionId: 'paca', status: 'running' });
    expect(enqueueJob(db(), { kind: 'build', regionId: 'paca' })).toEqual({ error: 'busy' });
    finishJob(db(), j.id, { ok: true });
    expect(enqueueJob(db(), { kind: 'build', regionId: 'paca' })).toHaveProperty('job');
  });

  it('claims the oldest queued job once', () => {
    addRegion(db(), { catalog: 'paca' }); addRegion(db(), { catalog: 'bretagne' });
    const a = enqueueJob(db(), { kind: 'build', regionId: 'paca' });
    db().update(offlineJob).set({ createdAt: new Date(Date.now() - 1000) }).run();
    enqueueJob(db(), { kind: 'build', regionId: 'bretagne' });
    expect(claimNextJob(db())?.id).toBe('job' in a ? a.job.id : '');
    expect(claimNextJob(db())?.regionId).toBe('bretagne');
    expect(claimNextJob(db())).toBeNull();
  });

  it('a job left running is marked interrupted at start-up', () => {
    addRegion(db(), { catalog: 'paca' });
    enqueueJob(db(), { kind: 'build', regionId: 'paca' });
    claimNextJob(db());
    expect(recoverJobs(db())).toBe(1);
    expect(latestJobs(db()).builds.paca).toMatchObject({ status: 'failed', error: 'interrupted' });
  });

  it('heartbeat goes stale', () => {
    expect(workerAlive(db())).toBe(false);
    const t = new Date('2026-11-24T10:00:00Z');
    workerHeartbeat(db(), t);
    expect(workerAlive(db(), new Date(t.getTime() + 1000))).toBe(true);
    expect(workerAlive(db(), new Date(t.getTime() + WORKER_STALE_MS + 1))).toBe(false);
  });
});

describe('worker', () => {
  it('builds a region: map file, version, missing segments only', async () => {
    addRegion(db(), { catalog: 'paca' });
    fs.mkdirSync(path.join(dir, 'segments'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'segments', 'E5_N40.rd5'), 'already');
    enqueueJob(db(), { kind: 'build', regionId: 'paca' });
    expect(await workerTick(db(), deps)).toBe(true);
    expect(getRegion(db(), 'paca')).toMatchObject({ built: true, version: '20261101', sizeBytes: 12 });
    expect(fs.readFileSync(path.join(dir, 'offline', 'paca.pmtiles'), 'utf8')).toBe('pmtiles-data');
    const fetched = fetchSegment.mock.calls.map((c) => c[1]);
    expect(fetched).not.toContain('E5_N40');
    expect(fetched.length).toBe(getRegion(db(), 'paca')!.segments.length - 1);
    expect(latestJobs(db()).builds.paca).toMatchObject({ status: 'done', step: 'segments' });
    expect(workerAlive(db())).toBe(true);
    expect(await workerTick(db(), deps)).toBe(false);
  });

  it('a failed extract fails the job and leaves no partial file', async () => {
    addRegion(db(), { catalog: 'paca' });
    enqueueJob(db(), { kind: 'build', regionId: 'paca' });
    const job = claimNextJob(db())!;
    expect(await runJob(db(), job, { ...deps, extract: async (_s, out) => { fs.writeFileSync(out, 'x'); throw new Error('pmtiles exited with 1'); } })).toBe(false);
    expect(latestJobs(db()).builds.paca).toMatchObject({ status: 'failed', error: 'pmtiles exited with 1' });
    expect(fs.existsSync(path.join(dir, 'offline', 'paca.pmtiles.part'))).toBe(false);
    expect(getRegion(db(), 'paca')?.built).toBe(false);
  });

  it('refresh job rebuilds enabled packs and stores the result', async () => {
    addRegion(db(), { catalog: 'paca' });
    enqueueJob(db(), { kind: 'build', regionId: 'paca' });
    await workerTick(db(), { ...deps, source: 'https://x/20261001.pmtiles' });
    setRegionEnabled(db(), 'paca', true);
    enqueueJob(db(), { kind: 'refresh' });
    await workerTick(db(), deps);
    expect(getRegion(db(), 'paca')?.version).toBe('20261101');
    expect(getLastRefresh(db())).toMatchObject({ ok: true, regions: [{ id: 'paca', status: 'updated' }] });
    expect(latestJobs(db()).refresh).toMatchObject({ status: 'done' });
    expect((await runRefresh(db(), { ...deps, fetchSegment: async () => { throw new Error('down'); } })).ok).toBe(false);
  });
});

describe('/api/admin/offline jobs', () => {
  const req = (body: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  it('enqueues builds and refreshes, admin only', async () => {
    const { POST } = await import('@/app/api/admin/offline/route');
    addRegion(db(), { catalog: 'paca' });
    state.email = 'a@x.fr';
    expect((await POST(req({ build: 'paca' }))).status).toBe(403);
    state.email = 'admin@x.fr';
    expect((await POST(req({ build: 'atlantis' }))).status).toBe(404);
    expect((await POST(req({ build: 'paca' }))).status).toBe(200);
    const busy = await POST(req({ build: 'paca' }));
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ error: 'offlineBusy' });
    expect((await POST(req({ refresh: true }))).status).toBe(200);
    expect(latestJobs(db()).builds.paca).toMatchObject({ status: 'queued', createdBy: 'u1' });
  });
});

describe('monthly refresh schedule (#1751)', () => {
  it('due from the 2nd at 03:00 Paris, once per month', async () => {
    const { refreshDue } = await import('@/lib/offline/schedule');
    expect(refreshDue(new Date('2026-12-01T12:00:00Z'), '2026-11')).toBeNull();
    expect(refreshDue(new Date('2026-12-02T01:30:00Z'), '2026-11')).toBeNull(); // 02:30 Paris
    expect(refreshDue(new Date('2026-12-02T02:00:00Z'), '2026-11')).toBe('2026-12'); // 03:00 Paris
    expect(refreshDue(new Date('2026-12-20T02:00:00Z'), '2026-12')).toBeNull();
    expect(refreshDue(new Date('2026-07-02T01:00:00Z'), null)).toBe('2026-07'); // 03:00 CEST
    expect(refreshDue(new Date('2026-12-31T23:30:00Z'), '2026-12')).toBeNull(); // already January 1st in Paris
  });
  it('the worker queues it once, only with an enabled pack', async () => {
    const { scheduleMonthlyRefresh } = await import('@/lib/offline/schedule');
    const now = new Date('2026-12-05T10:00:00Z');
    expect(scheduleMonthlyRefresh(db(), now)).toBe(false); // no pack: month recorded, nothing queued
    expect(latestJobs(db()).refresh).toBeNull();
    addRegion(db(), { catalog: 'paca' });
    enqueueJob(db(), { kind: 'build', regionId: 'paca' });
    await workerTick(db(), { ...deps, now });
    setRegionEnabled(db(), 'paca', true);
    expect(scheduleMonthlyRefresh(db(), now)).toBe(false); // December already handled
    const jan = new Date('2027-01-02T09:00:00Z');
    expect(scheduleMonthlyRefresh(db(), jan)).toBe(true);
    expect(latestJobs(db()).refresh?.status).toBe('queued');
    expect(scheduleMonthlyRefresh(db(), jan)).toBe(false);
  });
});
