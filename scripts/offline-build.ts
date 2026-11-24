// Offline pack build (#1738):  npm run offline:build -- <region> [--source <url|file>] [--dry-run]
// <region> = catalogue id (paca, bretagne… `--list`), already registered region id, or a custom `--name "X" --bbox w,s,e,n`.
// Same code as the "Build" button of /admin/offline (run by the `offline-worker` service, #1749): extracts the region from
// the Protomaps planet build with `pmtiles extract` (HTTP range requests: only the region is downloaded) into
// <DATA>/offline/<region>.pmtiles, records version + size in `offline_region`, then downloads the missing BRouter segments.
// Source: PMTILES_SOURCE or the latest https://build.protomaps.com/YYYYMMDD.pmtiles.
import { getDb } from '../src/db';
import { REGION_CATALOG, segmentsForBbox } from '../src/lib/offline/regions';
import { addRegion, getRegion } from '../src/lib/offline/store';
import { buildRegion, latestSource } from '../src/lib/offline/build';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.argv.includes('--list')) { for (const r of REGION_CATALOG) console.log(`${r.id}\t${r.name}`); return; }
  const id = process.argv[2];
  if (!id || id.startsWith('--')) { console.error('Usage: offline:build <region> [--name N --bbox w,s,e,n] [--source url] [--dry-run] | --list'); process.exit(2); }
  const { db } = getDb();
  let region = getRegion(db, id);
  if (!region) {
    const added = addRegion(db, arg('--bbox') ? { name: arg('--name') ?? id, bbox: arg('--bbox') } : { catalog: id });
    if ('error' in added) { console.error(`Unknown region "${id}" (use --list, or --name and --bbox w,s,e,n).`); process.exit(2); }
    region = added.region;
  }
  const source = arg('--source') || (await latestSource());
  console.log(`Region ${region.id}: bbox ${region.bbox.join(',')}, segments ${segmentsForBbox(region.bbox).join(' ')}\nSource: ${source}`);
  if (process.argv.includes('--dry-run')) return;
  const r = await buildRegion(db, region, { source, onStep: (s) => console.log(`step: ${s}`) });
  console.log(`Done: ${region.id} ${r.version} (${(r.sizeBytes / 1e6).toFixed(1)} MB). Enable it in /admin/offline.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
