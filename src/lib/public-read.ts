import { getCurrentUser } from '@/lib/current-user';
import { clientIp, rateLimit } from '@/lib/outings/rate-limit';

/** Map reads without a session (#1589): 120 requests / minute / IP for an anonymous visitor. */
export const ANON_READ_LIMIT = 120;

/**
 * Who is reading? Optional session (`user` null = anonymous). An anonymous visitor is rate-limited (429); a signed-in one is not here.
 * `rejected`: response to return as is.
 */
export async function readViewer(req: Request): Promise<{ user: { id: string } | null; rejected?: Response }> {
  const user = await getCurrentUser().catch(() => null);
  if (user) return { user };
  if (!rateLimit(`anonread:${clientIp(req)}`, ANON_READ_LIMIT, 60_000)) {
    return { user: null, rejected: Response.json({ error: 'tooManyRequests' }, { status: 429, headers: { 'Retry-After': '60' } }) };
  }
  return { user: null };
}

/**
 * HTTP cache: an anonymous response only contains public data (`public`, shareable); signed in, `private`.
 * `Vary: Cookie`: a shared cache never mixes the two.
 */
export function readCacheHeaders(anonymous: boolean, maxAge = 60): Record<string, string> {
  return { 'Cache-Control': anonymous ? `public, max-age=${maxAge}, must-revalidate` : `private, max-age=${maxAge}, must-revalidate`, Vary: 'Cookie' };
}
