import { getDb } from '@/db';
import { appJson, withAppAuth } from '@/lib/app/http';
import { listAppOutings } from '@/lib/app/outings';

export const dynamic = 'force-dynamic';

/** My outings (organiser or linked guest): upcoming and the last 30 days (#1720). */
export const GET = withAppAuth(async (_req, _c, auth) => appJson({ outings: listAppOutings(getDb().db, auth.userId) }));
