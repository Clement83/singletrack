// Removes duplicated lines from stored ridden tracks (#1699):  npm run rides:dedupe [-- --dry-run] [--no-backup]
//  - BACKUP: consistent copy of the database into <database folder>/backups/ before any write (except --dry-run / --no-backup).
//  - IDEMPOTENT: only rides that still hold a duplicated line are rewritten; a second run changes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../src/db';
import { dedupeStoredRides } from '../src/lib/outings/dedupe-rides';

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const { db, sqlite } = getDb();
  if (!dryRun && !args.has('--no-backup')) {
    const dir = path.join(path.dirname(sqlite.name), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `singletrack-avant-dedupe-rides-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    await sqlite.backup(dest);
    console.log(`Backup: ${dest}`);
  }
  const r = dedupeStoredRides(db, {
    dryRun,
    onItem: (id, b, a) => console.log(`${dryRun ? '[dry-run] ' : ''}ride ${id}: ${(b.distanceM / 1000).toFixed(1)} km / ${b.gainM ?? '-'} m -> ${(a.distanceM / 1000).toFixed(1)} km / ${a.gainM ?? '-'} m`),
  });
  console.log(`rides: ${r.seen} seen, ${r.changed} ${dryRun ? 'to change' : 'changed'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
