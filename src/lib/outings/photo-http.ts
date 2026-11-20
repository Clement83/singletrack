import { getDb } from '@/db';
import type { OutingRow } from '@/db/schema';
import type { Actor } from './comments';
import { clientIp, rateLimit } from './rate-limit';
import { resolveTakenAt } from './photo-time';
import { deletePhoto, listPhotos, PHOTO_MAX_BYTES, readPhoto, savePhoto } from './photos';

type Ctx = { outing: OutingRow; actor: Actor } | undefined;
type Params = Promise<Record<string, string>>;

const STATUS = { not_found: 404, closed: 409, tooEarly: 409, tooLarge: 413, notImage: 422, tooMany: 409 } as const;
const NOT_FOUND = () => Response.json({ error: 'not_found' }, { status: 404 });
const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : null);
const num = (v: FormDataEntryValue | null) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/** List / upload (multipart `file`, optional `lat`, `lon`, `taken`, `takenOffset`) of the photos, and file / deletion of a photo. */
export function photoHandlers(resolve: (req: Request, p: Record<string, string>) => Promise<Ctx>, limitKey: (req: Request, p: Record<string, string>) => string) {
  return {
    async list(req: Request, { params }: { params: Params }) {
      const p = await params;
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      return Response.json({ photos: listPhotos(getDb().db, ctx.outing.id, ctx.actor) });
    },
    async upload(req: Request, { params }: { params: Params }) {
      const p = await params;
      // A burst of photos from one person stays possible (30/min); the IP limit is wider (behind the same wifi).
      if (!rateLimit(`photo:${limitKey(req, p)}`, 30, 60_000) || !rateLimit(`photoip:${clientIp(req)}`, 90, 60_000)) {
        return Response.json({ error: 'tooManyRequests' }, { status: 429 });
      }
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      const declared = Number(req.headers.get('content-length'));
      if (declared > PHOTO_MAX_BYTES + 64 * 1024) return Response.json({ error: 'tooLarge' }, { status: 413 });
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof File)) return Response.json({ error: 'notImage' }, { status: 422 });
      if (file.size > PHOTO_MAX_BYTES) return Response.json({ error: 'tooLarge' }, { status: 413 });
      const lat = num(form!.get('lat'));
      const lon = num(form!.get('lon'));
      const res = await savePhoto(getDb().db, ctx.outing, ctx.actor, Buffer.from(await file.arrayBuffer()), {
        pos: Number.isNaN(lat) || Number.isNaN(lon) ? null : { lat, lon },
        takenAt: resolveTakenAt(str(form!.get('taken')), str(form!.get('takenOffset'))),
      });
      return res.ok ? Response.json({ ok: true, id: res.id }, { status: 201 }) : Response.json({ error: res.error }, { status: STATUS[res.error] });
    },
    async file(req: Request, { params }: { params: Params }) {
      const p = await params;
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      const buf = readPhoto(getDb().db, ctx.outing.id, p.id, new URL(req.url).searchParams.get('size') === 'thumb');
      if (!buf) return NOT_FOUND();
      return new Response(new Uint8Array(buf), {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Robots-Tag': 'noindex' },
      });
    },
    async remove(req: Request, { params }: { params: Params }) {
      const p = await params;
      if (!rateLimit(`photo:${limitKey(req, p)}`, 30, 60_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      return deletePhoto(getDb().db, ctx.outing, ctx.actor, p.id) ? Response.json({ ok: true }) : NOT_FOUND();
    },
  };
}
