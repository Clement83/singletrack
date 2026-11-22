import { getDb } from '@/db';
import { guestContext } from '@/lib/outings';
import { musicHandler } from '@/lib/outings/recap-http';

export const dynamic = 'force-dynamic';

// Public, no account: same personal link as the recap. Revoked or unknown link → 404.
export const GET = musicHandler(async (_r, p) => guestContext(getDb().db, p.token));
