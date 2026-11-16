import { isFederationPath } from './federation/paths';

/**
 * Routes accessibles sans session. Tout le reste est privé (sûr par défaut).
 * Les routes de données publiques vont sous /api/s/ et /api/t/ (cache hors-ligne, voir AGENTS.md).
 */
const PUBLIC_BASES = ['/login', '/s', '/t', '/i', '/api/auth', '/api/health', '/api/s', '/api/t', '/api/i', '/cal', '/offline', '/icons'];
const PUBLIC_EXACT = ['/api/locale', '/manifest.webmanifest', '/sw.js', '/icon.svg', '/favicon.ico', '/robots.txt'];

export function isPublicPath(pathname: string): boolean {
  // Fédération (#1474) : /.well-known/webfinger|nodeinfo, /nodeinfo, /ap (sans session, signatures HTTP à la place).
  return isFederationPath(pathname) || PUBLIC_EXACT.includes(pathname) || PUBLIC_BASES.some((b) => pathname === b || pathname.startsWith(`${b}/`));
}
