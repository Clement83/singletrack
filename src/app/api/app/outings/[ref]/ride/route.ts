import { getDb } from '@/db';
import { withAppAuth } from '@/lib/app/http';
import { appOutingContext } from '@/lib/app/outings';
import { authenticateApp } from '@/lib/app/tokens';
import { rideHandlers } from '@/lib/outings/ride-http';

export const dynamic = 'force-dynamic';

// Ridden track upload with an app token (#1720): same handler, limits and rights as `/api/outings/<slug>/ride` and `/api/i/<token>/ride`.
const h = rideHandlers(
  async (req, p) => {
    const { db } = getDb();
    const auth = authenticateApp(db, req);
    return auth ? appOutingContext(db, auth.userId, p.ref) : undefined;
  },
  (_r, p) => `app:${p.ref}`,
);
export const GET = withAppAuth((req, c) => h.list(req, c));
export const POST = withAppAuth((req, c) => h.upload(req, c));
export const DELETE = withAppAuth((req, c) => h.remove(req, c));
