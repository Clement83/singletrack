// Offline pack worker (#1749):  npm run offline:worker
// Long-running service (`offline-worker` in compose, tools image: it has the `pmtiles` binary). Every 10 s it writes a
// heartbeat and runs the next job queued from /admin/offline (build a region, refresh every pack), one at a time.
// A job left running by a crash or restart is marked failed (`interrupted`) at start-up. SIGTERM: stops after the current job.
import { getDb } from '../src/db';
import { recoverJobs } from '../src/lib/offline/jobs';
import { workerTick } from '../src/lib/offline/worker';

const POLL_MS = 10_000;
let stopping = false;
let wake: (() => void) | null = null;
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { stopping = true; wake?.(); });

async function main() {
  const { db } = getDb();
  const recovered = recoverJobs(db);
  console.log(`[offline-worker] started${recovered ? `, ${recovered} interrupted job(s) marked failed` : ''}`);
  const log = (msg: string) => console.log(`[offline-worker] ${msg}`);
  while (!stopping) {
    const ran = await workerTick(db, { log });
    if (!ran && !stopping) await new Promise<void>((r) => { wake = r; setTimeout(r, POLL_MS); });
  }
  console.log('[offline-worker] stopped');
}

main().catch((e) => { console.error(e); process.exit(1); });
