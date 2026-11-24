import { getDb } from '@/db';
import { authenticateApp } from './tokens';

type Params = Promise<Record<string, string>>;
export type AppRouteCtx = { params: Params };

export const APP_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } as const;
export const appJson = (body: unknown, status = 200) => Response.json(body, { status, headers: APP_HEADERS });
export const appUnauthorized = () => Response.json({ error: 'unauthorized' }, { status: 401, headers: { ...APP_HEADERS, 'WWW-Authenticate': 'Bearer' } });
export const appNotFound = () => appJson({ error: 'not_found' }, 404);

/** `/api/app/*` route: `Authorization: Bearer <app token>` only (never the session cookie). Missing or revoked ⇒ 401. */
export function withAppAuth(fn: (req: Request, c: AppRouteCtx, auth: { userId: string; tokenId: string }) => Promise<Response>) {
  return async (req: Request, c: AppRouteCtx) => {
    const auth = authenticateApp(getDb().db, req);
    return auth ? fn(req, c, auth) : appUnauthorized();
  };
}
