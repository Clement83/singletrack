import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { offlineUsage, user } from '@/db/schema';
import { parseRange } from '@/lib/outings/video-http';
import { rateLimit } from '@/lib/outings/rate-limit';
import { REGION_ID_RE } from './regions';
import { getRegion, listRegions, offlineDir, packsEnabled, type RegionRow } from './store';

/** Offline packs served to the companion app (#1739). */

export const OFFLINE_ATTRIBUTION = '© OpenStreetMap contributors (ODbL) · Protomaps · Mapzen Terrain Tiles (AWS Open Data)';
const SEGMENT_RE = /^[EW]\d{1,3}_[NS]\d{1,2}$/;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };

/** Requests per minute per token, and bytes per rolling 24 h per token (env `OFFLINE_DAILY_QUOTA_MB`, default 20 GB). */
export const REQUESTS_PER_MINUTE = 600;
export const dailyQuotaBytes = () => (Number(process.env.OFFLINE_DAILY_QUOTA_MB) > 0 ? Number(process.env.OFFLINE_DAILY_QUOTA_MB) : 20_480) * 1_000_000;

export function segmentsDir(): string {
  return process.env.BROUTER_SEGMENTS_DIR || path.join(path.dirname(process.env.DATABASE_URL || './data/singletrack.db'), 'brouter', 'segments');
}

const hashCache = new Map<string, { sig: string; sha256: string }>();
/** sha256 of a file, cached per size + mtime (segments are 60–240 MB). */
async function sha256(file: string, st: fs.Stats): Promise<string> {
  const sig = `${st.size}:${st.mtimeMs}`;
  const c = hashCache.get(file);
  if (c?.sig === sig) return c.sha256;
  const h = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer);
  const sha = h.digest('hex');
  hashCache.set(file, { sig, sha256: sha });
  return sha;
}

export const activeRegions = (db: Db): RegionRow[] => listRegions(db).filter((r) => r.enabled && r.built);

function regionFile(r: RegionRow): string | null {
  if (!REGION_ID_RE.test(r.id)) return null;
  const f = path.join(offlineDir(), `${r.id}.pmtiles`);
  return fs.existsSync(f) ? f : null;
}

/** Segment file served only if one active region lists it and the file exists. */
function segmentFile(db: Db, name: string): string | null {
  if (!SEGMENT_RE.test(name) || !activeRegions(db).some((r) => r.segments.includes(name))) return null;
  const f = path.join(segmentsDir(), `${name}.rd5`);
  return fs.existsSync(f) ? f : null;
}

export async function offlineCatalog(db: Db, origin: string) {
  if (!packsEnabled(db)) return { enabled: false, regions: [], style: null, attribution: OFFLINE_ATTRIBUTION };
  const regions = [];
  for (const r of activeRegions(db)) {
    const segments = [];
    for (const name of r.segments) {
      const f = segmentFile(db, name);
      if (!f) continue; // not on this server: the app cannot route there
      const st = fs.statSync(f);
      segments.push({ name, size: st.size, sha256: await sha256(f, st) });
    }
    regions.push({ id: r.id, name: r.name, bbox: r.bbox, pmtilesSize: r.sizeBytes, version: r.version, segments });
  }
  return { enabled: true, regions, style: `${origin}/api/app/offline/style.json`, attribution: OFFLINE_ATTRIBUTION };
}

/* eslint-disable no-restricted-syntax -- style served to the native app: no CSS tokens there, fixed light topo palette like the web map */
/** MapLibre style: Protomaps vector basemap (from a region's PMTiles) + Terrarium hillshade. No labels (no glyph server offline). */
export function offlineStyle(pmtilesUrl: string) {
  const V = 'protomaps';
  return {
    version: 8,
    name: 'Singletrack offline',
    sources: {
      [V]: { type: 'vector', url: `pmtiles://${pmtilesUrl}`, attribution: OFFLINE_ATTRIBUTION },
      dem: { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15, tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'] },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } },
      { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35 } },
      { id: 'landuse', type: 'fill', source: V, 'source-layer': 'landuse', paint: { 'fill-color': '#d8e8c8', 'fill-opacity': 0.6 } },
      { id: 'natural', type: 'fill', source: V, 'source-layer': 'natural', paint: { 'fill-color': '#cfe3b8', 'fill-opacity': 0.5 } },
      { id: 'water', type: 'fill', source: V, 'source-layer': 'water', paint: { 'fill-color': '#a8cdea' } },
      { id: 'buildings', type: 'fill', source: V, 'source-layer': 'buildings', minzoom: 14, paint: { 'fill-color': '#d9d0c9' } },
      { id: 'roads-minor', type: 'line', source: V, 'source-layer': 'roads', filter: ['in', 'kind', 'minor_road', 'other', 'path'], minzoom: 12, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 18, 6] } },
      { id: 'roads-major', type: 'line', source: V, 'source-layer': 'roads', filter: ['in', 'kind', 'highway', 'major_road', 'medium_road'], paint: { 'line-color': '#f7c873', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 18, 10] } },
      { id: 'boundaries', type: 'line', source: V, 'source-layer': 'boundaries', paint: { 'line-color': '#9a8aa8', 'line-dasharray': [3, 2], 'line-width': 1 } },
    ],
  };
}

/* eslint-enable no-restricted-syntax */

type Auth = { userId: string; tokenId: string };

/** 429 when the token exceeds its request rate or its daily byte quota. */
export function throttled(db: Db, auth: Auth, now = new Date()): Response | null {
  const day = new Date(now.getTime() - 24 * 3_600_000);
  const row = db.select({ n: sql<number>`coalesce(sum(${offlineUsage.bytes}), 0)` }).from(offlineUsage)
    .where(and(eq(offlineUsage.tokenId, auth.tokenId), gte(offlineUsage.createdAt, day))).get();
  if (!rateLimit(`offline:${auth.tokenId}`, REQUESTS_PER_MINUTE, 60_000, now.getTime()) || (row?.n ?? 0) >= dailyQuotaBytes()) {
    return Response.json({ error: 'rate_limited' }, { status: 429, headers: { ...HEADERS, 'Retry-After': '60' } });
  }
  return null;
}

function logUsage(db: Db, auth: Auth, kind: string, name: string, bytes: number) {
  db.insert(offlineUsage).values({ tokenId: auth.tokenId, userId: auth.userId, kind, name, bytes }).run();
}

/** Serves a file with `Range` (206) and `ETag`; logs the bytes of the served range. */
function sendFile(db: Db, auth: Auth, req: Request, file: string, kind: string, name: string, etag: string, requireRange: boolean): Response {
  const size = fs.statSync(file).size;
  const range = parseRange(req.headers.get('range'), size);
  if (range === 'invalid') return new Response(null, { status: 416, headers: { ...HEADERS, 'Content-Range': `bytes */${size}` } });
  if (!range && requireRange) return new Response(null, { status: 416, headers: { ...HEADERS, 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' } });
  const ifRange = req.headers.get('if-range');
  const full = !range || (ifRange !== null && ifRange !== etag);
  const { start, end } = full ? { start: 0, end: size - 1 } : range;
  logUsage(db, auth, kind, name, end - start + 1);
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, {
    status: full ? 200 : 206,
    headers: {
      ...HEADERS, ETag: etag, 'Content-Type': 'application/octet-stream', 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes',
      ...(full ? {} : { 'Content-Range': `bytes ${start}-${end}/${size}` }),
    },
  });
}

/** `<region>.pmtiles`: `Range` required (the app reads the archive by ranges). Null if not served ⇒ caller answers 404. */
export function pmtilesResponse(db: Db, auth: Auth, req: Request, id: string): Response | null {
  if (!packsEnabled(db)) return null;
  const r = getRegion(db, id);
  const f = r && r.enabled && r.built ? regionFile(r) : null;
  return f && r ? sendFile(db, auth, req, f, 'pmtiles', id, `"${r.version ?? r.builtAt?.getTime() ?? 'v'}"`, true) : null;
}

export function segmentResponse(db: Db, auth: Auth, req: Request, name: string): Response | null {
  if (!packsEnabled(db)) return null;
  const f = segmentFile(db, name);
  if (!f) return null;
  const st = fs.statSync(f);
  return sendFile(db, auth, req, f, 'segment', name, `"${st.size}-${Math.floor(st.mtimeMs)}"`, false);
}

/** Usage for /admin: bytes per account over the last 30 days. */
export function usageSummary(db: Db, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 24 * 3_600_000);
  return db.select({ userId: offlineUsage.userId, name: user.name, email: user.email, bytes: sql<number>`sum(${offlineUsage.bytes})`, requests: sql<number>`count(*)`, last: sql<number>`max(${offlineUsage.createdAt})` })
    .from(offlineUsage).innerJoin(user, eq(user.id, offlineUsage.userId)).where(gte(offlineUsage.createdAt, since))
    .groupBy(offlineUsage.userId).orderBy(desc(sql`sum(${offlineUsage.bytes})`)).all();
}

