// Monthly refresh of the offline packs (#1740):  npm run offline:refresh [-- --dry-run] [--source <url|file>] [--no-segments]
// Rebuilds every enabled, already built region from the latest Protomaps build (atomic replacement: temporary file then
// rename, version = build date, an unchanged version is skipped) and refreshes the BRouter segments they list (only if the
// remote file is newer; routing is never interrupted). The result is stored for /admin/offline. Exit code 1 if anything failed.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getDb } from '../src/db';
import { listRegions, offlineDir } from '../src/lib/offline/store';
import { segmentsDir } from '../src/lib/offline/serve';
import { needsRebuild, refreshRegion, refreshSegment, saveLastRefresh, sourceVersion, type RefreshResult } from '../src/lib/offline/refresh';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

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
  const dry = process.argv.includes('--dry-run');
  const { db } = getDb();
  const regions = listRegions(db).filter((r) => r.enabled && r.built);
  const result: RefreshResult = { at: new Date().toISOString(), ok: true, regions: [], segments: [] };
  if (regions.length === 0) { console.log('No enabled region: nothing to refresh.'); return; }
  const source = arg('--source') || process.env.PMTILES_SOURCE || (await latestSource());
  console.log(`Source: ${source} (version ${sourceVersion(source)})`);

  for (const r of regions) {
    const target = path.join(offlineDir(), `${r.id}.pmtiles`);
    if (dry) { console.log(`[dry-run] ${r.id}: ${r.version} -> ${sourceVersion(source)} ${needsRebuild(r.version, sourceVersion(source)) ? 'rebuild' : 'unchanged'}`); continue; }
    try {
      const status = refreshRegion(db, r, target, source, (tmp) => {
        execFileSync(process.env.PMTILES_BIN || 'pmtiles', ['extract', source, tmp, `--bbox=${r.bbox.join(',')}`], { stdio: 'inherit' });
      });
      result.regions.push({ id: r.id, status, version: sourceVersion(source) });
      console.log(`${r.id}: ${status}`);
    } catch (e) {
      result.ok = false;
      result.regions.push({ id: r.id, status: 'failed', error: String((e as Error).message).slice(0, 200) });
      console.error(`${r.id}: failed`, e);
    }
  }

  const names = [...new Set(regions.flatMap((r) => r.segments))].sort();
  for (const name of names) {
    if (dry || process.argv.includes('--no-segments')) { if (dry) console.log(`[dry-run] segment ${name}`); continue; }
    try {
      const status = await refreshSegment(segmentsDir(), name);
      result.segments.push({ name, status });
      console.log(`segment ${name}: ${status}`);
    } catch (e) {
      result.ok = false;
      result.segments.push({ name, status: 'failed' });
      console.error(`segment ${name}: failed`, e);
    }
  }
  if (!dry) { saveLastRefresh(db, result); if (!result.ok) process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
