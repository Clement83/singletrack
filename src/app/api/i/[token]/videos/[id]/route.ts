import { getDb } from '@/db';
import { guestContext } from '@/lib/outings';
import { videoHandlers } from '@/lib/outings/video-http';

export const dynamic = 'force-dynamic';

const h = videoHandlers(async (_r, p) => guestContext(getDb().db, p.token), (_r, p) => `t:${p.token.slice(0, 16)}`);
export const GET = h.file;
export const DELETE = h.remove;
