// DATAtourisme mountain-bike circuits sync (#1643):
//   npm run sync:datatourisme                    # departments of SYNC_ZONES (empty = all of France), incremental
//   npm run sync:datatourisme -- 71 74           # explicit departments
//   npm run sync:datatourisme -- france          # the whole of France
//   options: --full (ignore the last run date), --dry-run (measure only: no download, no write), --pages N
// Strict limits (one API request at a time, ≥ 6 s apart, ≤ 500/hour; trace files one at a time, ≥ 2 s apart).
// Resumable: an interrupted run continues from data/<database>.datatourisme-state.json. Idempotent upsert on the UUID.
import path from 'node:path';
import { getDb } from '../src/db';
import { config, sourceEnabled } from '../src/lib/config';
import { DatatourismeClient, datatourismeApiKey, syncDatatourisme } from '../src/lib/datatourisme';

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const pagesIdx = argv.indexOf('--pages');
  const maxPages = pagesIdx >= 0 ? Number(argv[pagesIdx + 1]) : undefined;
  const positional = argv.filter((a, i) => !a.startsWith('--') && !(pagesIdx >= 0 && i === pagesIdx + 1));
  const zones = positional.some((a) => a.toLowerCase() === 'france') ? [] : positional.length ? positional : config.syncZones;
  return { zones, full: flags.has('--full'), dryRun: flags.has('--dry-run'), maxPages };
}

async function main() {
  if (!sourceEnabled('datatourisme')) {
    console.log('Source "datatourisme" disabled (DATA_SOURCES): nothing to do.');
    return;
  }
  const apiKey = datatourismeApiKey();
  if (!apiKey) {
    console.log('DATA_TOURISM_API_KEY is not set: DATAtourisme sync skipped (see .env.example).');
    return;
  }
  const { zones, full, dryRun, maxPages } = parseArgs(process.argv.slice(2));
  // One state file per database (data/singletrack.db → data/singletrack.datatourisme-state.json): the throwaway
  // dev copy (data/dev.db) must never move the production run's resume point or last run date.
  const dbFile = process.env.DATABASE_URL ?? './data/singletrack.db';
  const stateFile = path.join(path.dirname(dbFile), `${path.basename(dbFile, path.extname(dbFile))}.datatourisme-state.json`);
  const { db } = getDb();
  const client = new DatatourismeClient({ apiKey, log: console.log });
  console.log(`DATAtourisme sync — ${zones.length ? `departments ${zones.join(', ')}` : 'all of France'}${full ? ', full' : ''}${dryRun ? ', dry run' : ''}.`);
  const r = await syncDatatourisme({ db, client, zones, stateFile, full, dryRun, maxPages, log: console.log });
  console.log(
    `Done: ${r.read}/${r.total ?? '?'} circuits read, ${r.read - r.withoutTrace} with a trace file, ${r.withoutTrace} without; ` +
      (dryRun ? '' : `${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged, ${r.duplicates} duplicates skipped, ${r.invalidTrace} unusable files, ${r.errors} errors; `) +
      `${r.apiRequests} API requests, ${r.fileRequests} file downloads.`,
  );
  if (r.errors > 0 && r.created + r.updated + r.unchanged === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
