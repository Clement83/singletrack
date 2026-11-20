import { getDb } from '@/db';
import { guestContext } from '@/lib/outings';
import { videoHandlers } from '@/lib/outings/video-http';

export const dynamic = 'force-dynamic';

// Public, no account: the personal link designates ONE invitation (author of the videos). Revoked link → 404.
const h = videoHandlers(async (_r, p) => guestContext(getDb().db, p.token), (_r, p) => `t:${p.token.slice(0, 16)}`);
export const GET = h.list;
export const POST = h.upload;
