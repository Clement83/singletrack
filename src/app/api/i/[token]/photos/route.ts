import { getDb } from '@/db';
import { guestContext } from '@/lib/outings';
import { photoHandlers } from '@/lib/outings/photo-http';

export const dynamic = 'force-dynamic';

// Public, sans compte : le lien perso désigne UNE invitation (auteur des photos). Lien révoqué → 404.
const h = photoHandlers(async (_r, p) => guestContext(getDb().db, p.token), (_r, p) => `t:${p.token.slice(0, 16)}`);
export const GET = h.list;
export const POST = h.upload;
