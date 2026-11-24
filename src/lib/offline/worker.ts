import type { Db } from '@/db';
import { buildRegion, runRefresh, type Extract, type SegmentFetch } from './build';
import { claimNextJob, finishJob, setJobStep, workerHeartbeat, type Job } from './jobs';
import { getRegion } from './store';

/** Job runner of the `offline-worker` service (#1749); the loop lives in `scripts/offline-worker.ts`. */

type Deps = { source?: string; extract?: Extract; fetchSegment?: SegmentFetch; log?: (msg: string) => void };

/** Runs one claimed job and records its outcome; never throws. */
export async function runJob(db: Db, job: Job, deps: Deps = {}): Promise<boolean> {
  const log = deps.log ?? (() => {});
  try {
    if (job.kind === 'build') {
      const region = job.regionId ? getRegion(db, job.regionId) : null;
      if (!region) throw new Error('regionGone');
      const r = await buildRegion(db, region, { ...deps, onStep: (step) => { setJobStep(db, job.id, step); workerHeartbeat(db); } });
      log(`build ${region.id}: ${r.version}, ${(r.sizeBytes / 1e6).toFixed(1)} MB`);
    } else if (job.kind === 'refresh') {
      setJobStep(db, job.id, 'map');
      const r = await runRefresh(db, { ...deps, log });
      if (!r.ok) throw new Error('refreshPartial');
    } else throw new Error('unknownKind');
    finishJob(db, job.id, { ok: true });
    return true;
  } catch (e) {
    const error = (e as Error).message || 'unknown';
    log(`job ${job.id} (${job.kind} ${job.regionId ?? ''}) failed: ${error}`);
    finishJob(db, job.id, { ok: false, error });
    return false;
  }
}

/** One worker tick: heartbeat, then the next queued job if any. Returns true when a job ran. */
export async function workerTick(db: Db, deps: Deps = {}): Promise<boolean> {
  workerHeartbeat(db);
  const job = claimNextJob(db);
  if (!job) return false;
  const beat = setInterval(() => workerHeartbeat(db), 30_000);
  try { await runJob(db, job, deps); } finally { clearInterval(beat); workerHeartbeat(db); }
  return true;
}
