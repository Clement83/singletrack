import { getDb } from '@/db';
import { commentHandlers } from '@/lib/outings/comments-http';
import { guestContext } from '@/lib/outings';

export const dynamic = 'force-dynamic';

// Public, no account: the identity (and the displayed first name) comes from the personal link. Revoked link → 404.
const h = commentHandlers(async (_r, p) => guestContext(getDb().db, p.token), (_r, p) => `t:${p.token.slice(0, 16)}`);
export const GET = h.list;
export const POST = h.create;
