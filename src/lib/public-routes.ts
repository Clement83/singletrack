import { isFederationPath } from './federation/paths';

/**
 * Routes accessibles sans session. Tout le reste est privé (sûr par défaut).
 * Les routes de données publiques vont sous /api/s/ et /api/t/ (cache hors-ligne, voir AGENTS.md).
 */
const PUBLIC_BASES = ['/login', '/s', '/t', '/i', '/api/auth', '/api/health', '/api/s', '/api/t', '/api/i', '/cal', '/offline', '/icons'];
// `/` : carte des traces ouverte aux visiteurs sans compte (#1591), qui n'y voient que le public.
const PUBLIC_EXACT = ['/', '/api/locale', '/manifest.webmanifest', '/sw.js', '/icon.svg', '/favicon.ico', '/robots.txt'];

/**
 * Lectures **GET seulement** ouvertes sans session pour la carte (#1589). Chaque route filtre elle-même par visibilité
 * (anonyme = traces et sorties `public` seulement). Tout le reste de `/api/tracks/*` (segments, import, écritures) reste privé.
 */
const PUBLIC_READ_EXACT = ['/api/tracks', '/api/tracks/geometry', '/api/outings/map'];
const PRIVATE_TRACK_SUBROUTES = ['segments', 'import'];

export function isPublicRead(pathname: string, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (PUBLIC_READ_EXACT.includes(pathname)) return true;
  const m = /^\/api\/tracks\/([^/]+)$/.exec(pathname); // GET /api/tracks/<slug> (fiche)
  return !!m && !PRIVATE_TRACK_SUBROUTES.includes(m[1]);
}

export function isPublicPath(pathname: string): boolean {
  // Fédération (#1474) : /.well-known/webfinger|nodeinfo, /nodeinfo, /ap (sans session, signatures HTTP à la place).
  return isFederationPath(pathname) || PUBLIC_EXACT.includes(pathname) || PUBLIC_BASES.some((b) => pathname === b || pathname.startsWith(`${b}/`));
}
