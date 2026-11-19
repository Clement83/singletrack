import { getDb } from '@/db';
import { guestContext } from '@/lib/outings';
import { rideHandlers } from '@/lib/outings/ride-http';

export const dynamic = 'force-dynamic';

// Public, no account: the personal link designates ONE invitation, hence ONE track (their own). Revoked link → 404.
const h = rideHandlers(async (_r, p) => guestContext(getDb().db, p.token), (_r, p) => `t:${p.token.slice(0, 16)}`);
export const GET = h.list;
export const POST = h.upload;
export const DELETE = h.remove;
