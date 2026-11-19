import { safeNext } from './safe-next';

/** Sign-in link that brings back to the current page afterwards (#1591: the map with its view `?t=&z=&lat=&lng=`) when `safeNext` accepts it. */
export function loginHref(loc: { pathname: string; search: string }): string {
  const next = safeNext(`${loc.pathname}${loc.search}`);
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}
