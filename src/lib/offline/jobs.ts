import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { instanceSetting, offlineJob } from '@/db/schema';
import { getRegion } from './store';

/**
 * Offline pack job queue (#1749). `/admin/offline` enqueues, the separate `offline-worker` service (tools image, it has
 * the `pmtiles` binary) claims and runs one job at a time. The web app never runs a build nor talks to Docker.
 */

export type JobKind = 'build' | 'refresh';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type Job = typeof offlineJob.$inferSelect;

const HEARTBEAT = 'offline.workerSeenAt';
/** The worker writes its heartbeat every poll (10 s) and during a job: older than this, it is considered stopped. */
export const WORKER_STALE_MS = 2 * 60_000;
const ACTIVE: JobStatus[] = ['queued', 'running'];

/** Enqueues a build (one region) or a refresh (every enabled region); refused while the same job is queued or running. */
export function enqueueJob(db: Db, input: { kind: JobKind; regionId?: string | null; userId?: string | null }): { job: Job } | { error: 'not_found' | 'busy' } {
  const regionId = input.kind === 'build' ? input.regionId ?? null : null;
  if (input.kind === 'build' && (!regionId || !getRegion(db, regionId))) return { error: 'not_found' };
  const same = and(eq(offlineJob.kind, input.kind), regionId ? eq(offlineJob.regionId, regionId) : isNull(offlineJob.regionId), inArray(offlineJob.status, ACTIVE));
  if (db.select({ id: offlineJob.id }).from(offlineJob).where(same).get()) return { error: 'busy' };
  const job = db.insert(offlineJob).values({ kind: input.kind, regionId, createdBy: input.userId ?? null }).returning().get();
  return { job };
}

/** Atomically takes the oldest queued job (a single UPDATE, safe even with two workers). */
export function claimNextJob(db: Db, now = new Date()): Job | null {
  const next = sql`(select ${offlineJob.id} from ${offlineJob} where ${offlineJob.status} = 'queued' order by ${offlineJob.createdAt} limit 1)`;
  return db.update(offlineJob).set({ status: 'running', startedAt: now, step: null, error: null })
    .where(and(eq(offlineJob.id, next), eq(offlineJob.status, 'queued'))).returning().get() ?? null;
}

export function setJobStep(db: Db, id: string, step: string) {
  db.update(offlineJob).set({ step }).where(eq(offlineJob.id, id)).run();
}

export function finishJob(db: Db, id: string, r: { ok: true } | { ok: false; error: string }, now = new Date()) {
  db.update(offlineJob).set({ status: r.ok ? 'done' : 'failed', error: r.ok ? null : r.error.slice(0, 200), finishedAt: now })
    .where(eq(offlineJob.id, id)).run();
}

/** At worker start-up: a job left `running` was interrupted (crash, restart); finished jobs older than 90 days are pruned. */
export function recoverJobs(db: Db, now = new Date()): number {
  const n = db.update(offlineJob).set({ status: 'failed', error: 'interrupted', finishedAt: now }).where(eq(offlineJob.status, 'running')).run().changes;
  db.delete(offlineJob).where(and(inArray(offlineJob.status, ['done', 'failed']), lt(offlineJob.createdAt, new Date(now.getTime() - 90 * 86_400_000)))).run();
  return n;
}

/** Latest job per region (`build`) and latest refresh job, for `/admin/offline`. */
export function latestJobs(db: Db): { builds: Record<string, Job>; refresh: Job | null } {
  const builds: Record<string, Job> = {};
  for (const j of db.select().from(offlineJob).where(eq(offlineJob.kind, 'build')).orderBy(desc(offlineJob.createdAt)).all())
    if (j.regionId && !builds[j.regionId]) builds[j.regionId] = j;
  const refresh = db.select().from(offlineJob).where(eq(offlineJob.kind, 'refresh')).orderBy(desc(offlineJob.createdAt)).limit(1).get() ?? null;
  return { builds, refresh };
}

export function workerHeartbeat(db: Db, now = new Date()) {
  const value = String(now.getTime());
  db.insert(instanceSetting).values({ key: HEARTBEAT, value }).onConflictDoUpdate({ target: instanceSetting.key, set: { value } }).run();
}

/** True when the worker wrote its heartbeat less than `WORKER_STALE_MS` ago. */
export function workerAlive(db: Db, now = new Date()): boolean {
  const row = db.select().from(instanceSetting).where(eq(instanceSetting.key, HEARTBEAT)).get();
  return !!row && now.getTime() - Number(row.value) < WORKER_STALE_MS;
}
