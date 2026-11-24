import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { openDb } from '@/db';
import { instanceSetting, offlineRegion } from '@/db/schema';
import { catalogRegion, parseBbox, REGION_ID_RE, segmentsForBbox, slugify, type Bbox } from './regions';

type DB = ReturnType<typeof openDb>['db'];

export function offlineDir(): string {
  return process.env.OFFLINE_DIR || path.join(path.dirname(process.env.DATABASE_URL || './data/singletrack.db'), 'offline');
}

/** Master switch: env `OFFLINE_PACKS_ENABLED` (1/true/on/yes; default off) AND the admin setting (default on). */
export function envPacksEnabled(): boolean {
  return ['1', 'true', 'on', 'yes'].includes((process.env.OFFLINE_PACKS_ENABLED ?? '').trim().toLowerCase());
}

const SETTING = 'offline.enabled';

export function adminSwitch(db: DB): boolean {
  const row = db.select().from(instanceSetting).where(eq(instanceSetting.key, SETTING)).get();
  return row ? row.value === '1' : true;
}

export function setAdminSwitch(db: DB, on: boolean) {
  db.insert(instanceSetting).values({ key: SETTING, value: on ? '1' : '0' })
    .onConflictDoUpdate({ target: instanceSetting.key, set: { value: on ? '1' : '0' } }).run();
}

/** Packs are served only if the env flag AND the admin switch are on. */
export function packsEnabled(db: DB): boolean {
  return envPacksEnabled() && adminSwitch(db);
}

export type RegionRow = {
  id: string; name: string; bbox: Bbox; enabled: boolean; sizeBytes: number | null; version: string | null;
  builtAt: Date | null; segments: string[]; built: boolean;
};

function toRow(r: typeof offlineRegion.$inferSelect): RegionRow {
  return {
    id: r.id, name: r.name, bbox: JSON.parse(r.bbox) as Bbox, enabled: r.enabled, sizeBytes: r.sizeBytes, version: r.version,
    builtAt: r.builtAt, segments: JSON.parse(r.segments) as string[], built: !!r.pmtilesPath,
  };
}

export function listRegions(db: DB): RegionRow[] {
  return db.select().from(offlineRegion).all().map(toRow).sort((a, b) => a.name.localeCompare(b.name));
}

export function getRegion(db: DB, id: string): RegionRow | null {
  const r = db.select().from(offlineRegion).where(eq(offlineRegion.id, id)).get();
  return r ? toRow(r) : null;
}

/** Registers a region from the catalogue (`{catalog}`) or a custom one (`{name, bbox}`). Returns the row or an error code. */
export function addRegion(db: DB, input: { catalog?: unknown; name?: unknown; bbox?: unknown }): { region: RegionRow } | { error: 'invalid' | 'exists' } {
  let id: string; let name: string; let bbox: Bbox | null;
  if (typeof input.catalog === 'string') {
    const c = catalogRegion(input.catalog);
    if (!c) return { error: 'invalid' };
    id = c.id; name = c.name; bbox = c.bbox;
  } else {
    name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
    id = slugify(name);
    bbox = parseBbox(input.bbox);
    if (!name || !REGION_ID_RE.test(id) || !bbox) return { error: 'invalid' };
  }
  if (getRegion(db, id)) return { error: 'exists' };
  db.insert(offlineRegion).values({ id, name, bbox: JSON.stringify(bbox), segments: JSON.stringify(segmentsForBbox(bbox)) }).run();
  return { region: getRegion(db, id)! };
}

/** Enables/disables a region; only a built pack can be enabled. */
export function setRegionEnabled(db: DB, id: string, enabled: boolean): 'ok' | 'not_found' | 'not_built' {
  const r = getRegion(db, id);
  if (!r) return 'not_found';
  if (enabled && !r.built) return 'not_built';
  db.update(offlineRegion).set({ enabled }).where(eq(offlineRegion.id, id)).run();
  return 'ok';
}

/** Records a finished build. */
export function recordBuild(db: DB, id: string, b: { pmtilesPath: string; sizeBytes: number; version: string; segments: string[] }) {
  db.update(offlineRegion).set({ ...b, segments: JSON.stringify(b.segments), builtAt: new Date() }).where(eq(offlineRegion.id, id)).run();
}

/** Deletes a region and its file (frees the disk space). */
export function deleteRegion(db: DB, id: string): boolean {
  const r = db.select().from(offlineRegion).where(eq(offlineRegion.id, id)).get();
  if (!r) return false;
  if (REGION_ID_RE.test(id)) fs.rmSync(path.join(offlineDir(), `${id}.pmtiles`), { force: true });
  db.delete(offlineRegion).where(eq(offlineRegion.id, id)).run();
  return true;
}
