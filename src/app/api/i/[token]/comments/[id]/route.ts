import { getDb } from '@/db';
import { commentHandlers } from '@/lib/outings/comments-http';
import { guestContext } from '@/lib/outings';

export const dynamic = 'force-dynamic';

const h = commentHandlers(async (_r, p) => guestContext(getDb().db, p.token), (_r, p) => `t:${p.token.slice(0, 16)}`);
export const PATCH = h.edit;
export const DELETE = h.remove;
