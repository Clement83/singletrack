import { getDb } from '@/db';
import { guestContext } from '@/lib/outings';
import { recapHandlers } from '@/lib/outings/recap-http';

export const dynamic = 'force-dynamic';

// Public, no account: the personal link designates ONE invitation. Revoked or unknown link → 404.
const h = recapHandlers(async (_r, p) => guestContext(getDb().db, p.token));
export const GET = h.get;
