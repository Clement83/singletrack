// Offline pack build (#1738):  npm run offline:build -- <region> [--source <url|file>] [--dry-run]
// <region> = catalogue id (paca, bretagne… `--list`), already registered region id, or a custom `--name "X" --bbox w,s,e,n`.
// Extracts the region from the Protomaps planet build with `pmtiles extract` (HTTP range requests: only the region is
// downloaded, never the whole planet) into <DATA>/offline/<region>.pmtiles, computes the BRouter .rd5 segments covering it
// and records version + size in `offline_region`. Source: PMTILES_SOURCE or the latest https://build.protomaps.com/YYYYMMDD.pmtiles.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getDb } from '../src/db';
import { REGION_CATALOG } from '../src/lib/offline/regions';
import { addRegion, getRegion, offlineDir, recordBuild } from '../src/lib/offline/store';
import { segmentsForBbox } from '../src/lib/offline/regions';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Latest Protomaps daily build still published (tries today, then back 10 days). */
async function latestSource(): Promise<string> {
  for (let d = 0; d < 10; d++) {
    const date = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://build.protomaps.com/${date}.pmtiles`;
    const res = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (res?.ok) return url;
  }
  throw new Error('No Protomaps build found; set PMTILES_SOURCE.');
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
  const segments = segmentsForBbox(region.bbox);
  const dir = offlineDir();
  const out = path.join(dir, `${region.id}.pmtiles`);
  const source = arg('--source') || process.env.PMTILES_SOURCE || (await latestSource());
  const cmd = ['extract', source, `${out}.part`, `--bbox=${region.bbox.join(',')}`];
  console.log(`Region ${region.id}: bbox ${region.bbox.join(',')}, segments ${segments.join(' ')}\nSource: ${source}`);
  if (process.argv.includes('--dry-run')) { console.log(`[dry-run] ${process.env.PMTILES_BIN || 'pmtiles'} ${cmd.join(' ')}`); return; }
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(process.env.PMTILES_BIN || 'pmtiles', cmd, { stdio: 'inherit' });
  fs.renameSync(`${out}.part`, out);
  const size = fs.statSync(out).size;
  recordBuild(db, region.id, { pmtilesPath: out, sizeBytes: size, version: path.basename(source).replace(/\.pmtiles$/, ''), segments });
  console.log(`Done: ${out} (${(size / 1e6).toFixed(1)} MB). Enable it in /admin/offline.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
