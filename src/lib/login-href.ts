import { safeNext } from './safe-next';

/** Lien de connexion qui ramène à la page courante après coup (#1591 : la carte avec sa vue `?t=&z=&lat=&lng=`) quand `safeNext` l'accepte. */
export function loginHref(loc: { pathname: string; search: string }): string {
  const next = safeNext(`${loc.pathname}${loc.search}`);
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}
