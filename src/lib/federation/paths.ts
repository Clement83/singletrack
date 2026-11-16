/** Chemins servis par la fédération (#1474) : publics (signatures, pas de session), 404 si `FEDERATION=off`. */
const BASES = ['/.well-known/webfinger', '/.well-known/nodeinfo', '/nodeinfo', '/ap'];

export function isFederationPath(pathname: string): boolean {
  return BASES.some((b) => pathname === b || pathname.startsWith(`${b}/`));
}
