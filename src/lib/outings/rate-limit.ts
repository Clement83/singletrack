/** Limiteur en mémoire (fenêtre fixe) pour les endpoints invités publics. Un seul processus : suffisant. */
const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const h = hits.get(key);
  if (!h || h.reset <= now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    return true;
  }
  h.n += 1;
  return h.n <= max;
}

/** IP du client derrière nginx (X-Forwarded-For). */
export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

export function _resetRateLimit() {
  hits.clear();
}
