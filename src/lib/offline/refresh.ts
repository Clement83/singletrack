import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { instanceSetting } from '@/db/schema';
import { recordBuild, type RegionRow } from './store';

/** Monthly refresh of the offline packs (#1740). */

const KEY = 'offline.lastRefresh';

export type RefreshResult = { at: string; ok: boolean; regions: { id: string; status: 'updated' | 'unchanged' | 'failed'; version?: string; error?: string }[]; segments: { name: string; status: 'updated' | 'unchanged' | 'failed' }[] };

export function getLastRefresh(db: Db): RefreshResult | null {
  const row = db.select().from(instanceSetting).where(eq(instanceSetting.key, KEY)).get();
  if (!row) return null;
  try { return JSON.parse(row.value) as RefreshResult; } catch { return null; }
}

export function saveLastRefresh(db: Db, r: RefreshResult) {
  const value = JSON.stringify(r);
  db.insert(instanceSetting).values({ key: KEY, value }).onConflictDoUpdate({ target: instanceSetting.key, set: { value } }).run();
}

/** Version of a Protomaps build URL/file (`20261101.pmtiles` ⇒ `20261101`). */
export function sourceVersion(source: string): string {
  return path.basename(source).replace(/\.pmtiles$/, '');
}

/** A refresh is useless when the source build is not newer than the served version (versions are YYYYMMDD, compared as text). */
export function needsRebuild(current: string | null, next: string): boolean {
  return !current || next > current;
}

/**
 * Atomic replacement: `build(tmp)` writes the new file, which then replaces `target` with a single `rename`.
 * A download already streaming keeps reading the old inode to the end; the temporary file is removed on failure.
 */
export function replaceAtomically(target: string, build: (tmp: string) => void) {
  const tmp = `${target}.part`;
  try {
    build(tmp);
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Rebuilds one region's pack through `build` and records the new version; unchanged when the source is not newer. */
export function refreshRegion(db: Db, r: RegionRow, target: string, source: string, build: (tmp: string) => void): 'updated' | 'unchanged' {
  const version = sourceVersion(source);
  if (!needsRebuild(r.version, version)) return 'unchanged';
  replaceAtomically(target, build);
  recordBuild(db, r.id, { pmtilesPath: target, sizeBytes: fs.statSync(target).size, version, segments: r.segments });
  return 'updated';
}

/** Downloads a BRouter segment only if the remote one is newer (If-Modified-Since); atomic replacement, BRouter keeps serving. */
export async function refreshSegment(dir: string, name: string, fetcher: typeof fetch = fetch): Promise<'updated' | 'unchanged'> {
  const file = path.join(dir, `${name}.rd5`);
  const headers: Record<string, string> = {};
  if (fs.existsSync(file)) headers['If-Modified-Since'] = fs.statSync(file).mtime.toUTCString();
  const res = await fetcher(`https://brouter.de/brouter/segments4/${name}.rd5`, { headers });
  if (res.status === 304) return 'unchanged';
  if (!res.ok || !res.body) throw new Error(`segment ${name}: HTTP ${res.status}`);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
    const modified = res.headers.get('last-modified');
    if (modified) fs.utimesSync(tmp, new Date(), new Date(modified));
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return 'updated';
}
