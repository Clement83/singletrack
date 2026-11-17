/** Paramètres de la carte qu'un retour après connexion peut rapporter (#1591) : vue (#1577) et filtres (`src/lib/tracks/filters.ts`). */
const MAP_PARAM = /^[a-zA-Z]{1,16}$/;

/**
 * Retour après connexion : la page d'un lien invité `/i/<token>` (#1434) ou la carte `/` avec sa vue (#1591, `?t=&z=&lat=&lng=`),
 * jamais une URL libre (pas de redirection ouverte).
 */
export function safeNext(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 1000) return undefined;
  if (/^\/i\/[A-Za-z0-9_-]{20,100}$/.test(value)) return value;
  if (value !== '/' && !value.startsWith('/?')) return undefined;
  const params = new URLSearchParams(value.slice(2));
  for (const k of params.keys()) if (!MAP_PARAM.test(k)) return undefined;
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}
