import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outingVideo, type OutingRow } from '@/db/schema';
import { validPos } from '@/lib/media/exif';
import { probeVideo } from '@/lib/media/ffmpeg';
import { convertVideo, type Encoder } from '@/lib/media/video-convert';
import type { Actor } from './comments';
import { mediaDir } from './photos';
import { canUploadRide } from './ride';

/** Limits (#1693): a short clip, not a film. */
export const VIDEO_MAX_BYTES = 150 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 30;
/** Phones stop a "30 s" clip a few frames late. */
const DURATION_TOLERANCE_MS = 1000;
/** Videos per outing, all participants together (disk guard). Failed conversions do not count. */
export const VIDEO_MAX_PER_OUTING = 15;
/** Accepted sources: MP4/MOV, H.264 or HEVC. */
const CODECS = new Set(['h264', 'hevc']);

export type VideoStatus = 'pending' | 'ready' | 'failed';
export type VideoView = {
  id: string;
  author: string;
  organizer: boolean;
  mine: boolean;
  canDelete: boolean;
  status: VideoStatus;
  width: number;
  height: number;
  durationMs: number;
  takenAt: number | null;
  pos: { lat: number; lon: number } | null;
};
export type VideoError = 'not_found' | 'closed' | 'tooEarly' | 'tooLarge' | 'notVideo' | 'tooLong' | 'tooMany';
export type VideoResult<T = object> = ({ ok: true } & T) | { ok: false; error: VideoError };

type Kind = 'src' | 'mp4' | 'thumb' | 'tmp';
const EXT: Record<Kind, string> = { src: '.src', mp4: '.mp4', thumb: '.thumb.jpg', tmp: '.tmp.mp4' };
/** File of a video. Ids are UUIDs read back from the database (or generated here): no forged path. */
export const videoFile = (dir: string, outingId: string, id: string, kind: Kind) => join(dir, outingId, `${id}.video${EXT[kind]}`);

const isMine = (r: { invitationId: string | null; authorUserId: string | null }, a: Actor) =>
  a.kind === 'guest' ? r.invitationId === a.invitationId : r.invitationId === null && r.authorUserId === a.userId;

const countActive = (db: Db, outingId: string) =>
  db.select({ id: outingVideo.id }).from(outingVideo).where(and(eq(outingVideo.outingId, outingId), ne(outingVideo.status, 'failed'))).all().length;

/** Checks that do not need the file (done before reading the body, then again on save). */
export function checkVideoUpload(db: Db, o: OutingRow, now = new Date()): VideoError | null {
  if (o.status === 'cancelled') return 'closed';
  if (!canUploadRide(o, now)) return 'tooEarly';
  if (countActive(db, o.id) >= VIDEO_MAX_PER_OUTING) return 'tooMany';
  return null;
}

/**
 * Streams a request body to a temporary file of the media folder, stopping past `VIDEO_MAX_BYTES`
 * (the video never sits in memory). Returns the path, or `tooLarge`.
 */
export async function receiveUpload(body: ReadableStream<Uint8Array> | null, dir = mediaDir()): Promise<{ ok: true; path: string } | { ok: false; error: 'tooLarge' | 'notVideo' }> {
  if (!body) return { ok: false, error: 'notVideo' };
  mkdirSync(join(dir, 'tmp'), { recursive: true });
  const path = join(dir, 'tmp', `${crypto.randomUUID()}.upload`);
  let n = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length;
      cb(n > VIDEO_MAX_BYTES ? new Error('tooLarge') : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream), limit, createWriteStream(path));
  } catch (e) {
    rmSync(path, { force: true });
    return { ok: false, error: (e as Error).message === 'tooLarge' ? 'tooLarge' : 'notVideo' };
  }
  if (n === 0) {
    rmSync(path, { force: true });
    return { ok: false, error: 'notVideo' };
  }
  return { ok: true, path };
}

/**
 * Registers an uploaded clip (`upload` = temporary file, moved or deleted here): ffprobe checks it (MP4/MOV,
 * H.264/HEVC, ≤ 30 s), reads capture time and position, then the conversion is queued. The original is deleted once converted.
 */
export async function saveVideo(
  db: Db, o: OutingRow, actor: Actor, upload: string,
  opts: { now?: Date; dir?: string; enqueue?: boolean } = {},
): Promise<VideoResult<{ id: string }>> {
  const dir = opts.dir ?? mediaDir();
  const fail = (error: VideoError): VideoResult<{ id: string }> => {
    rmSync(upload, { force: true });
    return { ok: false, error };
  };
  if (statSync(upload).size > VIDEO_MAX_BYTES) return fail('tooLarge');
  const pre = checkVideoUpload(db, o, opts.now);
  if (pre) return fail(pre);
  const p = await probeVideo(upload);
  if (!p || !CODECS.has(p.codec) || !/(^|,)(mov|mp4)(,|$)/.test(p.container)) return fail('notVideo');
  if (p.durationMs > VIDEO_MAX_SECONDS * 1000 + DURATION_TOLERANCE_MS) return fail('tooLong');
  const pos = p.pos && validPos(p.pos.lat, p.pos.lon) ? { lat: Math.round(p.pos.lat * 1e4) / 1e4, lon: Math.round(p.pos.lon * 1e4) / 1e4 } : null;
  const row = db.insert(outingVideo).values({
    outingId: o.id, status: 'pending', width: p.displayWidth, height: p.displayHeight, durationMs: p.durationMs,
    lat: pos?.lat ?? null, lon: pos?.lon ?? null, takenAt: p.takenAt, createdAt: opts.now,
    invitationId: actor.kind === 'guest' ? actor.invitationId : null,
    authorUserId: actor.kind === 'organizer' ? actor.userId : null,
  }).returning({ id: outingVideo.id }).get();
  mkdirSync(join(dir, o.id), { recursive: true });
  renameSync(upload, videoFile(dir, o.id, row.id, 'src'));
  if (opts.enqueue !== false) enqueueVideo(db, row.id, dir);
  return { ok: true, id: row.id };
}

/**
 * Converts one pending video (called by the queue, one at a time). Success ⇒ `ready` + original deleted;
 * failure ⇒ `failed` (the author or the organiser can delete it). A video deleted meanwhile leaves no file behind.
 */
export async function processVideo(db: Db, id: string, dir = mediaDir(), opts: { plan?: Encoder[] } = {}): Promise<VideoStatus | null> {
  const v = db.select().from(outingVideo).where(eq(outingVideo.id, id)).get();
  if (!v || v.status !== 'pending') return v?.status ?? null;
  const f = (k: Kind) => videoFile(dir, v.outingId, v.id, k);
  const src = f('src');
  const p = existsSync(src) ? await probeVideo(src) : null;
  const res = p ? await convertVideo(src, f('tmp'), f('thumb'), p, opts) : ({ ok: false, error: 'source missing or unreadable' } as const);
  const still = db.select({ id: outingVideo.id }).from(outingVideo).where(eq(outingVideo.id, id)).get();
  if (!still) {
    for (const k of ['src', 'tmp', 'thumb', 'mp4'] as const) rmSync(f(k), { force: true });
    return null;
  }
  if (!res.ok) {
    console.warn(`[Video] conversion failed for ${id}: ${res.error}`);
    for (const k of ['src', 'tmp', 'thumb'] as const) rmSync(f(k), { force: true });
    db.update(outingVideo).set({ status: 'failed' }).where(eq(outingVideo.id, id)).run();
    return 'failed';
  }
  renameSync(f('tmp'), f('mp4'));
  rmSync(src, { force: true });
  db.update(outingVideo).set({ status: 'ready', width: res.width, height: res.height, durationMs: res.durationMs, encoder: res.encoder }).where(eq(outingVideo.id, id)).run();
  return 'ready';
}

/** Conversion queue: one at a time (the iGPU is shared with Frigate, Immich and Jellyfin), outside the HTTP request. */
type Queue = { tail: Promise<unknown>; size: number };
const g = globalThis as unknown as { __singletrackVideoQueue?: Queue };
const queue = (): Queue => (g.__singletrackVideoQueue ??= { tail: Promise.resolve(), size: 0 });

export function enqueueVideo(db: Db, id: string, dir = mediaDir(), opts: { plan?: Encoder[] } = {}): Promise<VideoStatus | null> {
  const q = queue();
  q.size++;
  const job = q.tail.then(() => processVideo(db, id, dir, opts)).catch((e) => {
    console.error(`[Video] conversion crashed for ${id}`, e);
    db.update(outingVideo).set({ status: 'failed' }).where(eq(outingVideo.id, id)).run();
    return 'failed' as const;
  }).finally(() => { q.size--; });
  q.tail = job;
  return job;
}

/** Resolves once every queued conversion is done (tests). */
export const videoQueueIdle = () => queue().tail.then(() => undefined);
export const videoQueueSize = () => queue().size;

/** Start-up: conversions interrupted by a restart are queued again (oldest first). */
export function resumePendingVideos(db: Db, dir = mediaDir()): number {
  const rows = db.select({ id: outingVideo.id }).from(outingVideo).where(eq(outingVideo.status, 'pending')).orderBy(asc(outingVideo.createdAt)).all();
  for (const r of rows) void enqueueVideo(db, r.id, dir);
  return rows.length;
}

/** Gallery: every participant sees the ready videos and the pending ones; a failed one only for whoever can delete it. */
export function listVideos(db: Db, outingId: string, actor: Actor): VideoView[] {
  const rows = db.select({ v: outingVideo, name: invitation.name }).from(outingVideo)
    .leftJoin(invitation, eq(invitation.id, outingVideo.invitationId))
    .where(eq(outingVideo.outingId, outingId)).orderBy(asc(outingVideo.createdAt), asc(outingVideo.id)).all();
  return rows.flatMap(({ v, name }) => {
    const mine = isMine(v, actor);
    const canDelete = mine || actor.kind === 'organizer';
    if (v.status === 'failed' && !canDelete) return [];
    return [{
      id: v.id, author: name ?? '', organizer: v.invitationId === null, mine, canDelete, status: v.status,
      width: v.width, height: v.height, durationMs: v.durationMs, takenAt: v.takenAt,
      pos: v.lat != null && v.lon != null ? { lat: v.lat, lon: v.lon } : null,
    }];
  });
}

/** Deletes a video and its files (author or organiser). `false` if unknown or not allowed. */
export function deleteVideo(db: Db, o: OutingRow, actor: Actor, id: string, dir = mediaDir()): boolean {
  const v = db.select().from(outingVideo).where(and(eq(outingVideo.id, id), eq(outingVideo.outingId, o.id))).get();
  if (!v || !(actor.kind === 'organizer' || isMine(v, actor))) return false;
  db.delete(outingVideo).where(eq(outingVideo.id, id)).run();
  // A conversion in progress cleans its own output when it sees the row gone.
  for (const k of ['src', 'mp4', 'thumb'] as const) rmSync(videoFile(dir, o.id, id, k), { force: true });
  return true;
}

/** Path of the published MP4 or of its thumbnail, only for a ready video of this outing (`null` otherwise). */
export function readyVideoFile(db: Db, outingId: string, id: string, kind: 'mp4' | 'thumb', dir = mediaDir()): string | null {
  const v = db.select({ id: outingVideo.id, status: outingVideo.status }).from(outingVideo).where(and(eq(outingVideo.id, id), eq(outingVideo.outingId, outingId))).get();
  if (!v || v.status !== 'ready') return null;
  const f = videoFile(dir, outingId, v.id, kind);
  return existsSync(f) ? f : null;
}

/** For the HTTP layer: a read stream of a byte range of a file. */
export const fileRange = (path: string, start: number, end: number) => createReadStream(path, { start, end });
