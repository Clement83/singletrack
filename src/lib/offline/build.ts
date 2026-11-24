import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Db } from '@/db';
import { segmentsForBbox, type Bbox } from './regions';
import { listRegions, offlineDir, recordBuild, type RegionRow } from './store';
import { segmentsDir } from './serve';
import { needsRebuild, refreshRegion, refreshSegment, replaceAtomically, saveLastRefresh, sourceVersion, type RefreshResult } from './refresh';

/**
 * Pack building shared by the CLI (`offline:build`, `offline:refresh`) and the `offline-worker` service (#1749).
 * Needs the `pmtiles` binary: tools image only, never called by the web app.
 */

export type Extract = (source: string, out: string, bbox: Bbox) => Promise<void>;
export type SegmentFetch = (dir: string, name: string) => Promise<'updated' | 'unchanged'>;

/** Latest Protomaps daily build still published (tries today, then back 10 days). `PMTILES_SOURCE` overrides it. */
export async function latestSource(fetcher: typeof fetch = fetch): Promise<string> {
  if (process.env.PMTILES_SOURCE) return process.env.PMTILES_SOURCE;
  for (let d = 0; d < 10; d++) {
    const date = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://build.protomaps.com/${date}.pmtiles`;
    const res = await fetcher(url, { method: 'HEAD' }).catch(() => null);
    if (res?.ok) return url;
  }
  throw new Error('noSource');
}

/** `pmtiles extract` (HTTP range requests: only the region is downloaded), asynchronous so the worker keeps its heartbeat. */
export const extractPmtiles: Extract = (source, out, bbox) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.env.PMTILES_BIN || 'pmtiles', ['extract', source, out, `--bbox=${bbox.join(',')}`], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pmtiles exited with ${code}`))));
  });

/**
 * Builds one region: map extract (atomic replacement of `<OFFLINE_DIR>/<id>.pmtiles`), recorded with its version, then the
 * BRouter segments it needs that are missing on the server (existing ones are refreshed monthly, not here).
 */
export async function buildRegion(
  db: Db, region: RegionRow,
  opts: { source?: string; extract?: Extract; fetchSegment?: SegmentFetch; onStep?: (step: 'map' | 'segments') => void } = {},
): Promise<{ sizeBytes: number; version: string; segments: string[] }> {
  const source = opts.source ?? (await latestSource());
  const segments = segmentsForBbox(region.bbox);
  const out = path.join(offlineDir(), `${region.id}.pmtiles`);
  fs.mkdirSync(offlineDir(), { recursive: true });
  opts.onStep?.('map');
  await replaceAtomically(out, (tmp) => (opts.extract ?? extractPmtiles)(source, tmp, region.bbox));
  const sizeBytes = fs.statSync(out).size;
  const version = sourceVersion(source);
  recordBuild(db, region.id, { pmtilesPath: out, sizeBytes, version, segments });
  opts.onStep?.('segments');
  const dir = segmentsDir();
  for (const name of segments) if (!fs.existsSync(path.join(dir, `${name}.rd5`))) await (opts.fetchSegment ?? refreshSegment)(dir, name);
  return { sizeBytes, version, segments };
}

/**
 * Monthly refresh (#1740): rebuilds every enabled, built region from a newer Protomaps build and refreshes their BRouter
 * segments (only if the remote file is newer). The result is stored for `/admin/offline`.
 */
export async function runRefresh(
  db: Db,
  opts: { source?: string; dryRun?: boolean; noSegments?: boolean; extract?: Extract; fetchSegment?: SegmentFetch; log?: (msg: string) => void } = {},
): Promise<RefreshResult> {
  const log = opts.log ?? (() => {});
  const regions = listRegions(db).filter((r) => r.enabled && r.built);
  const result: RefreshResult = { at: new Date().toISOString(), ok: true, regions: [], segments: [] };
  if (regions.length === 0) { log('No enabled region: nothing to refresh.'); if (!opts.dryRun) saveLastRefresh(db, result); return result; }
  const source = opts.source ?? (await latestSource());
  log(`Source: ${source} (version ${sourceVersion(source)})`);

  for (const r of regions) {
    const target = path.join(offlineDir(), `${r.id}.pmtiles`);
    if (opts.dryRun) { log(`[dry-run] ${r.id}: ${r.version} -> ${sourceVersion(source)} ${needsRebuild(r.version, sourceVersion(source)) ? 'rebuild' : 'unchanged'}`); continue; }
    try {
      const status = await refreshRegion(db, r, target, source, (tmp) => (opts.extract ?? extractPmtiles)(source, tmp, r.bbox));
      result.regions.push({ id: r.id, status, version: sourceVersion(source) });
      log(`${r.id}: ${status}`);
    } catch (e) {
      result.ok = false;
      result.regions.push({ id: r.id, status: 'failed', error: String((e as Error).message).slice(0, 200) });
      log(`${r.id}: failed ${(e as Error).message}`);
    }
  }

  for (const name of [...new Set(regions.flatMap((r) => r.segments))].sort()) {
    if (opts.dryRun) { log(`[dry-run] segment ${name}`); continue; }
    if (opts.noSegments) continue;
    try {
      const status = await (opts.fetchSegment ?? refreshSegment)(segmentsDir(), name);
      result.segments.push({ name, status });
      log(`segment ${name}: ${status}`);
    } catch (e) {
      result.ok = false;
      result.segments.push({ name, status: 'failed' });
      log(`segment ${name}: failed ${(e as Error).message}`);
    }
  }
  if (!opts.dryRun) saveLastRefresh(db, result);
  return result;
}
