import { isFederationPath } from './federation/paths';

/**
 * Routes reachable without a session. Everything else is private (safe by default).
 * Public data routes go under /api/s/ and /api/t/ (offline cache, see AGENTS.md).
 */
const PUBLIC_BASES = ['/login', '/s', '/t', '/i', '/api/auth', '/api/health', '/api/s', '/api/t', '/api/i', '/cal', '/offline', '/icons'];
// `/`: track map open to visitors without an account (#1591), who only see public data.
const PUBLIC_EXACT = ['/', '/api/locale', '/manifest.webmanifest', '/sw.js', '/icon.svg', '/favicon.ico', '/robots.txt'];

/**
 * **GET-only** reads open without a session for the map (#1589). Each route filters by visibility itself
 * (anonymous = `public` tracks and outings only). The rest of `/api/tracks/*` (segments, import, writes) stays private.
 */
const PUBLIC_READ_EXACT = ['/api/tracks', '/api/tracks/geometry', '/api/outings/map'];
const PRIVATE_TRACK_SUBROUTES = ['segments', 'import'];

export function isPublicRead(pathname: string, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (PUBLIC_READ_EXACT.includes(pathname)) return true;
  if (/^\/api\/outings\/map\/[^/]+$/.test(pathname)) return true; // GET /api/outings/map/<id>: frozen route (#1596)
  const m = /^\/api\/tracks\/([^/]+)$/.exec(pathname); // GET /api/tracks/<slug> (fiche)
  return !!m && !PRIVATE_TRACK_SUBROUTES.includes(m[1]);
}

export function isPublicPath(pathname: string): boolean {
  // Federation (#1474): /.well-known/webfinger|nodeinfo, /nodeinfo, /ap (no session, HTTP signatures instead).
  return isFederationPath(pathname) || PUBLIC_EXACT.includes(pathname) || PUBLIC_BASES.some((b) => pathname === b || pathname.startsWith(`${b}/`));
}
