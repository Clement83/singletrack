// Elevation gain recomputation of existing data (#1519):  npm run elevation:recompute [-- --dry-run] [--force] [--no-backup]
// Re-elevates through IGN (replacement, #1515) then recomputes gain/loss/min/max (#1517) of tracks, outing snapshots
// (past ones included) and ridden tracks. Remote outings are not concerned.
//  - BACKUP: before any write, consistent copy of the database into <database folder>/backups/ (except --dry-run / --no-backup).
//  - IDEMPOTENT: a row is only rewritten if the result differs; a second run changes nothing.
//  - RESUME: processed rows are recorded in <database folder>/elevation-recompute.state (one key per line);
//    running again after an interruption continues where it stopped. `--force` starts over (deletes that file).
//  - IGN QUOTA: 5 req/s respected by enrichElevation (220 ms pause between requests, per-point cache).
//  - LOG: one line per failure, then the totals processed / changed / skipped / failed. Exit code 1 if anything failed.
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../src/db';
import { recomputeElevation } from '../src/lib/tracks/recompute-elevation';

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const { db, sqlite } = getDb();
  const dir = path.dirname(sqlite.name);
  const statePath = path.join(dir, 'elevation-recompute.state');

  if (!dryRun && !args.has('--no-backup')) {
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    const dest = path.join(dir, 'backups', `singletrack-avant-elevation-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    await sqlite.backup(dest);
    console.log(`Sauvegarde : ${dest}`);
  }
  if (args.has('--force') && fs.existsSync(statePath)) fs.rmSync(statePath);
  const done = new Set<string>(fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8').split('\n').filter(Boolean) : []);
  if (done.size) console.log(`Resuming: ${done.size} rows already processed (--force to redo everything).`);

  const report = await recomputeElevation(db, {
    done,
    dryRun,
    onProgress: (k) => fs.appendFileSync(statePath, `${k}\n`),
    onItem: (kind, id, outcome, detail) => {
      if (outcome === 'failed') console.error(`ÉCHEC ${kind} ${id} : ${detail}`);
      else if (outcome === 'changed') console.log(`${dryRun ? '[dry-run] ' : ''}changed ${kind} ${id}`);
    },
  });
  let failed = 0;
  for (const [kind, r] of Object.entries(report)) {
    failed += r.failed;
    console.log(`${kind}: ${r.seen} seen, ${r.changed} changed, ${r.skipped} skipped, ${r.failed} failed`);
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
