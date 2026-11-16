import { getDb } from '@/db';
import { guestContext } from '@/lib/outings';
import { rideHandlers } from '@/lib/outings/ride-http';

export const dynamic = 'force-dynamic';

// Public, sans compte : le lien perso désigne UNE invitation, donc UNE trace (la sienne). Lien révoqué → 404.
const h = rideHandlers(async (_r, p) => guestContext(getDb().db, p.token), (_r, p) => `t:${p.token.slice(0, 16)}`);
export const GET = h.list;
export const POST = h.upload;
export const DELETE = h.remove;
