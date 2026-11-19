import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { track } from '@/db/schema';
import { parseTrackFile } from '@/lib/geo';
import { upsertTrack } from '@/lib/tracks';
import type { DatatourismeClient } from './client';
import { findDuplicate } from './dedup';
import { fileGeometry, firstPageUrl, pickTraceFile, tourToTrack, type DtPage } from './tours';

/**
 * Resumable state (#1643), stored next to the database (`data/<database>.datatourisme-state.json`):
 * - `next`: page to resume from after an interrupted run (absolute `next` link given by the API);
 * - `zones`/`since`: the query that `next` belongs to (a different query starts over);
 * - `lastComplete`: day of the last complete run, used as `lastUpdate[gte]` by the next incremental run.
 */
export type SyncState = { next: string | null; zones: string[]; since: string | null; lastComplete: string | null };

export const EMPTY_STATE: SyncState = { next: null, zones: [], since: null, lastComplete: null };

export function readState(file: string): SyncState {
  try {
    return { ...EMPTY_STATE, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function writeState(file: string, s: SyncState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
}

export type SyncReport = {
  read: number;
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  withoutTrace: number;
  invalidTrace: number;
  errors: number;
  apiRequests: number;
  fileRequests: number;
  total: number | null;
};

export type SyncOptions = {
  db: Db;
  client: DatatourismeClient;
  zones: string[];
  stateFile: string;
  /** Ignore `lastComplete`: re-read every tour (still skips unchanged ones without downloading). */
  full?: boolean;
  /** Measure only: lists tours and counts traces, never downloads a file nor writes a track. */
  dryRun?: boolean;
  /** Stop after this many pages (tests, manual sampling). */
  maxPages?: number;
  log?: (msg: string) => void;
  today?: () => string;
};

const sameQuery = (s: SyncState, zones: string[], since: string | null) => s.since === since && s.zones.join(',') === zones.join(',');

export async function syncDatatourisme(o: SyncOptions): Promise<SyncReport> {
  const log = o.log ?? (() => {});
  const today = o.today ?? (() => new Date().toISOString().slice(0, 10));
  const startedOn = today();
  const state = readState(o.stateFile);
  const since = o.full ? null : state.lastComplete;
  let url = state.next && sameQuery(state, o.zones, since) ? state.next : firstPageUrl(o.zones, since);
  if (url === state.next) log(`Resuming an interrupted run.`);
  if (since) log(`Incremental run: tours updated since ${since}.`);

  const r: SyncReport = { read: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, withoutTrace: 0, invalidTrace: 0, errors: 0, apiRequests: 0, fileRequests: 0, total: null };
  const apiStart = o.client.api.count;
  const fileStart = o.client.files.count;
  let pages = 0;

  for (;;) {
    const page = await o.client.getJson<DtPage>(url);
    r.total ??= page.meta?.total ?? null;
    pages++;
    for (const t of page.objects ?? []) {
      r.read++;
      const file = pickTraceFile(t);
      if (!file) {
        r.withoutTrace++;
        continue;
      }
      if (o.dryRun) continue;
      const updatedAt = t.lastUpdate ? new Date(`${t.lastUpdate}T00:00:00Z`) : null;
      const existing = o.db
        .select({ sourceUpdatedAt: track.sourceUpdatedAt })
        .from(track)
        .where(and(eq(track.source, 'datatourisme'), eq(track.externalId, t.uuid)))
        .get();
      if (existing && updatedAt && existing.sourceUpdatedAt?.getTime() === updatedAt.getTime()) {
        r.unchanged++;
        continue;
      }
      try {
        const bytes = await o.client.getFile(file.url);
        let geometry;
        try {
          geometry = fileGeometry(parseTrackFile(`trace.${file.kind}`, bytes));
        } catch {
          geometry = null;
        }
        if (!geometry) {
          r.invalidTrace++;
          continue;
        }
        const dup = findDuplicate(o.db, geometry, t.uuid);
        if (dup) {
          r.duplicates++;
          log(`  = « ${t.label?.['@fr'] ?? t.uuid} » duplicates ${dup.source} « ${dup.name} »`);
          continue;
        }
        const res = await upsertTrack(o.db, tourToTrack(t, geometry, file), { enrich: false });
        if (res.created) r.created++;
        else r.updated++;
      } catch (e) {
        r.errors++;
        log(`  ✗ ${t.uuid} « ${t.label?.['@fr'] ?? ''} »: ${e instanceof Error ? e.message : e}`);
      }
    }
    const next = page.meta?.next ?? null;
    if (!o.dryRun) writeState(o.stateFile, { ...state, next, zones: o.zones, since });
    log(`Page ${pages}: ${r.read}/${r.total ?? '?'} read, ${r.created} created, ${r.updated} updated, ${r.duplicates} duplicates, ${r.withoutTrace} without trace.`);
    if (!next || (o.maxPages && pages >= o.maxPages)) {
      if (!next && !o.dryRun) writeState(o.stateFile, { next: null, zones: o.zones, since: null, lastComplete: startedOn });
      break;
    }
    url = next;
  }
  r.apiRequests = o.client.api.count - apiStart;
  r.fileRequests = o.client.files.count - fileStart;
  return r;
}
