/** Paths served by federation (#1474): public (signatures, no session), 404 if `FEDERATION=off`. */
const BASES = ['/.well-known/webfinger', '/.well-known/nodeinfo', '/nodeinfo', '/ap'];

export function isFederationPath(pathname: string): boolean {
  return BASES.some((b) => pathname === b || pathname.startsWith(`${b}/`));
}
