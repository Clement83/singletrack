import { getDb } from '@/db';
import { addComment, deleteComment, editComment, listComments, type CommentResult, type Actor } from './comments';
import type { OutingRow } from '@/db/schema';
import { clientIp, rateLimit } from './rate-limit';

type Ctx = { outing: OutingRow; actor: Actor } | undefined;

const STATUS = { not_found: 404, closed: 409, invalid: 422, forbidden: 403 } as const;

function fail(res: Extract<CommentResult, { ok: false }>) {
  return Response.json({ error: res.error, errors: res.errors }, { status: STATUS[res.error] });
}

const NOT_FOUND = () => Response.json({ error: 'not_found' }, { status: 404 });

/** GET/POST/PATCH/DELETE communs aux routes invité (`/api/i/<token>/comments`) et organisateur. */
export function commentHandlers(resolve: (req: Request, params: Record<string, string>) => Promise<Ctx>, limitKey: (req: Request, params: Record<string, string>) => string) {
  const limited = (req: Request, p: Record<string, string>) => !rateLimit(`cmt:${limitKey(req, p)}`, 20, 60_000);
  return {
    async list(req: Request, { params }: { params: Promise<Record<string, string>> }) {
      const p = await params;
      if (!rateLimit(`cmtr:${limitKey(req, p)}`, 120, 60_000)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      return Response.json({ comments: listComments(getDb().db, ctx.outing.id, ctx.actor) });
    },
    async create(req: Request, { params }: { params: Promise<Record<string, string>> }) {
      const p = await params;
      if (limited(req, p)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      const body = (await req.json().catch(() => null)) as { body?: unknown } | null;
      const res = addComment(getDb().db, ctx.outing, ctx.actor, body?.body);
      return res.ok ? Response.json({ ok: true, id: res.id }, { status: 201 }) : fail(res);
    },
    async edit(req: Request, { params }: { params: Promise<Record<string, string>> }) {
      const p = await params;
      if (limited(req, p)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      const body = (await req.json().catch(() => null)) as { body?: unknown } | null;
      const res = editComment(getDb().db, ctx.outing, ctx.actor, p.id, body?.body);
      return res.ok ? Response.json({ ok: true }) : fail(res);
    },
    async remove(req: Request, { params }: { params: Promise<Record<string, string>> }) {
      const p = await params;
      if (limited(req, p)) return Response.json({ error: 'tooManyRequests' }, { status: 429 });
      const ctx = await resolve(req, p);
      if (!ctx) return NOT_FOUND();
      const res = deleteComment(getDb().db, ctx.outing, ctx.actor, p.id);
      return res.ok ? Response.json({ ok: true }) : fail(res);
    },
  };
}
export { clientIp };
