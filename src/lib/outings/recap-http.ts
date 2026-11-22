import { getDb } from '@/db';
import type { OutingRow } from '@/db/schema';
import type { Actor } from './comments';
import { clientIp, rateLimit } from './rate-limit';
import { listMusic, musicFile, musicStream } from './music';
import { buildRecap, listRideChoices, setReferenceRide } from './recap';

type Ctx = { outing: OutingRow; actor: Actor } | undefined;
type Params = Promise<Record<string, string>>;
const NOT_FOUND = () => Response.json({ error: 'not_found' }, { status: 404 });

/** GET of the outing recap data (reference ridden track + placed photos), same rights as the photos. */
export function recapHandlers(resolve: (req: Request, p: Record<string, string>) => Promise<Ctx>) {
  return {
    async get(req: Request, { params }: { params: Params }) {
      const p = await params;
      if (!rateLimit(`recapip:${clientIp(req)}`, 60, 60_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      const { db } = getDb();
      return Response.json(
        { ...buildRecap(db, ctx.outing, ctx.actor), music: listMusic(), ...(ctx.actor.kind === 'organizer' ? { rides: listRideChoices(db, ctx.outing) } : {}) },
        { headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } },
      );
    },
  };
}

/** GET of background music track `<n>` for the summary export (#1706): same rights as the recap. */
export function musicHandler(resolve: (req: Request, p: Record<string, string>) => Promise<Ctx>) {
  return async (req: Request, { params }: { params: Params }) => {
    const p = await params;
    if (!rateLimit(`musicip:${clientIp(req)}`, 60, 60_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
    if (!(await resolve(req, p))) return NOT_FOUND();
    const f = musicFile(Number(p.n));
    if (!f) return NOT_FOUND();
    return new Response(musicStream(f.path), {
      headers: { 'Content-Type': f.type, 'Content-Length': String(f.size), 'Cache-Control': 'private, max-age=86400', 'X-Robots-Tag': 'noindex' },
    });
  };
}

/** PUT `{ rideId }`: the organiser picks the reference ridden track (organiser route only). */
export function referenceHandler(resolve: (req: Request, p: Record<string, string>) => Promise<Ctx>) {
  return async (req: Request, { params }: { params: Params }) => {
    const p = await params;
    const ctx = await resolve(req, p);
    if (!ctx || ctx.actor.kind !== 'organizer') return NOT_FOUND();
    const body = (await req.json().catch(() => null)) as { rideId?: unknown } | null;
    if (typeof body?.rideId !== 'string') return Response.json({ error: 'invalid' }, { status: 422 });
    return setReferenceRide(getDb().db, ctx.outing, body.rideId) ? Response.json({ ok: true }) : NOT_FOUND();
  };
}
