import { statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { getDb } from '@/db';
import type { OutingRow } from '@/db/schema';
import type { Actor } from './comments';
import { clientIp, rateLimit } from './rate-limit';
import { checkVideoUpload, deleteVideo, fileRange, listVideos, readyVideoFile, receiveUpload, saveVideo, VIDEO_MAX_BYTES } from './videos';

type Ctx = { outing: OutingRow; actor: Actor } | undefined;
type Params = Promise<Record<string, string>>;

const STATUS = { not_found: 404, closed: 409, tooEarly: 409, tooLarge: 413, notVideo: 422, tooLong: 422, tooMany: 409 } as const;
const NOT_FOUND = () => Response.json({ error: 'not_found' }, { status: 404 });
const HEADERS = { 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Robots-Tag': 'noindex' };

/** `bytes=a-b` / `bytes=a-` / `bytes=-n` → inclusive range, `null` if absent, `'invalid'` if unsatisfiable. */
export function parseRange(h: string | null, size: number): { start: number; end: number } | null | 'invalid' {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? 'invalid' : { start, end };
}

/**
 * Short videos (#1693), same rights as the photos: list, upload (raw body = the file, streamed to disk), file
 * (MP4 with HTTP Range, required by Safari, or `?size=thumb` JPEG) and deletion.
 */
export function videoHandlers(resolve: (req: Request, p: Record<string, string>) => Promise<Ctx>, limitKey: (req: Request, p: Record<string, string>) => string) {
  return {
    async list(req: Request, { params }: { params: Params }) {
      const p = await params;
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      return Response.json({ videos: listVideos(getDb().db, ctx.outing.id, ctx.actor) });
    },
    async upload(req: Request, { params }: { params: Params }) {
      const p = await params;
      // Same burst allowance as photos, per person then per IP.
      if (!rateLimit(`photo:${limitKey(req, p)}`, 30, 60_000) || !rateLimit(`photoip:${clientIp(req)}`, 90, 60_000)) {
        return Response.json({ error: 'tooManyRequests' }, { status: 429 });
      }
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      const { db } = getDb();
      const pre = checkVideoUpload(db, ctx.outing);
      if (pre) return Response.json({ error: pre }, { status: STATUS[pre] });
      if (Number(req.headers.get('content-length')) > VIDEO_MAX_BYTES) return Response.json({ error: 'tooLarge' }, { status: 413 });
      const type = req.headers.get('content-type') ?? '';
      if (type && !/^(video\/|application\/octet-stream)/.test(type)) return Response.json({ error: 'notVideo' }, { status: 422 });
      const up = await receiveUpload(req.body);
      if (!up.ok) return Response.json({ error: up.error }, { status: STATUS[up.error] });
      const res = await saveVideo(db, ctx.outing, ctx.actor, up.path);
      return res.ok ? Response.json({ ok: true, id: res.id }, { status: 201 }) : Response.json({ error: res.error }, { status: STATUS[res.error] });
    },
    async file(req: Request, { params }: { params: Params }) {
      const p = await params;
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      const thumb = new URL(req.url).searchParams.get('size') === 'thumb';
      const path = readyVideoFile(getDb().db, ctx.outing.id, p.id, thumb ? 'thumb' : 'mp4');
      if (!path) return NOT_FOUND();
      const size = statSync(path).size;
      const type = thumb ? 'image/jpeg' : 'video/mp4';
      const range = thumb ? null : parseRange(req.headers.get('range'), size);
      if (range === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      const { start, end } = range ?? { start: 0, end: size - 1 };
      const body = Readable.toWeb(fileRange(path, start, end)) as ReadableStream;
      return new Response(body, {
        status: range ? 206 : 200,
        headers: {
          ...HEADERS, 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
        },
      });
    },
    async remove(req: Request, { params }: { params: Params }) {
      const p = await params;
      if (!rateLimit(`photo:${limitKey(req, p)}`, 30, 60_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      return deleteVideo(getDb().db, ctx.outing, ctx.actor, p.id) ? Response.json({ ok: true }) : NOT_FOUND();
    },
  };
}
