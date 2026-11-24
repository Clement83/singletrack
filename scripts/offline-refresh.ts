// Monthly refresh of the offline packs (#1740):  npm run offline:refresh [-- --dry-run] [--source <url|file>] [--no-segments]
// Same code as the "Refresh now" button of /admin/offline (#1749): rebuilds every enabled, already built region from the
// latest Protomaps build (atomic replacement, an unchanged version is skipped) and refreshes the BRouter segments they list
// (only if the remote file is newer). The result is stored for /admin/offline. Exit code 1 if anything failed.
import { getDb } from '../src/db';
import { runRefresh } from '../src/lib/offline/build';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { db } = getDb();
  const r = await runRefresh(db, { source: arg('--source'), dryRun: process.argv.includes('--dry-run'), noSegments: process.argv.includes('--no-segments'), log: console.log });
  if (!r.ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
