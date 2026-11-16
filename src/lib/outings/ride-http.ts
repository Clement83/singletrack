import { getDb } from '@/db';
import type { OutingRow } from '@/db/schema';
import type { Actor } from './comments';
import { clientIp, rateLimit } from './rate-limit';
import { deleteRide, listRides, RIDE_MAX_BYTES, saveRide } from './ride';

type Ctx = { outing: OutingRow; actor: Actor } | undefined;
type Params = Promise<Record<string, string>>;

const STATUS = { not_found: 404, closed: 409, tooEarly: 409, tooLarge: 413, notGpx: 422, doctype: 422, noTrack: 422 } as const;
const NOT_FOUND = () => Response.json({ error: 'not_found' }, { status: 404 });

/** GET / POST (multipart `file`, .gpx ≤ 5 Mo) / DELETE de la trace roulée, communs aux routes invité et organisateur. */
export function rideHandlers(resolve: (req: Request, p: Record<string, string>) => Promise<Ctx>, limitKey: (req: Request, p: Record<string, string>) => string) {
  return {
    async list(req: Request, { params }: { params: Params }) {
      const p = await params;
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      return Response.json({ rides: listRides(getDb().db, ctx.outing.id, ctx.actor) });
    },
    async upload(req: Request, { params }: { params: Params }) {
      const p = await params;
      if (!rateLimit(`ride:${limitKey(req, p)}`, 10, 60_000) || !rateLimit(`rideip:${clientIp(req)}`, 30, 60_000)) {
        return Response.json({ error: 'tooManyRequests' }, { status: 429 });
      }
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof File)) return Response.json({ error: 'notGpx' }, { status: 422 });
      if (file.size > RIDE_MAX_BYTES) return Response.json({ error: 'tooLarge' }, { status: 413 });
      const res = await saveRide(getDb().db, ctx.outing, ctx.actor, await file.text());
      return res.ok ? Response.json({ ok: true, id: res.id }, { status: 201 }) : Response.json({ error: res.error }, { status: STATUS[res.error] });
    },
    async remove(req: Request, { params }: { params: Params }) {
      const p = await params;
      if (!rateLimit(`ride:${limitKey(req, p)}`, 10, 60_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      deleteRide(getDb().db, ctx.outing, ctx.actor);
      return Response.json({ ok: true });
    },
  };
}
