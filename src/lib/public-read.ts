import { getCurrentUser } from '@/lib/current-user';
import { clientIp, rateLimit } from '@/lib/outings/rate-limit';

/** Lectures de la carte sans session (#1589) : 120 requêtes / minute / IP pour un anonyme. */
export const ANON_READ_LIMIT = 120;

/**
 * Qui lit ? Session facultative (`user` nul = anonyme). Un anonyme est limité en débit (429) ; un connecté ne l'est pas ici.
 * `rejected` : réponse à renvoyer telle quelle.
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
 * Cache HTTP : une réponse anonyme ne contient que du public (`public`, partageable) ; connecté, `private`.
 * `Vary: Cookie` : un cache partagé ne mélange jamais les deux.
 */
export function readCacheHeaders(anonymous: boolean, maxAge = 60): Record<string, string> {
  return { 'Cache-Control': anonymous ? `public, max-age=${maxAge}, must-revalidate` : `private, max-age=${maxAge}, must-revalidate`, Vary: 'Cookie' };
}
