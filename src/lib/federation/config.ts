/**
 * Federation configuration (#1474). `FEDERATION=on|off`: `off` ⇒ no ActivityPub route answers and nothing is sent.
 * **On by default** (#1477, protections delivered): without `FEDERATION`, it is `on` as soon as the instance key
 * `FEDERATION_KEY_ENC` exists (`scripts/init-env.sh` generates it); without a key, it stays off (the instance still starts,
 * a warning is logged). An explicit `FEDERATION=on` requires the key (start-up refused otherwise). The domain comes from the
 * configuration, never from a request header.
 */
export function federationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.FEDERATION?.trim().toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return !!env.FEDERATION_KEY_ENC?.trim();
}

/** `FEDERATION` unset AND no key: federation off by default, to be reported at start-up. */
export const federationImplicitlyOff = (env: NodeJS.ProcessEnv = process.env) => !env.FEDERATION?.trim() && !env.FEDERATION_KEY_ENC?.trim();

/** Public origin of the instance (`https://domain`, no trailing slash). */
export function publicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PUBLIC_URL || env.BETTER_AUTH_URL || 'http://localhost:3000';
  return new URL(raw).origin;
}

/** Domain of the instance (host, with the port if not standard): right-hand part of `handle@domain`. */
export function instanceDomain(env: NodeJS.ProcessEnv = process.env): string {
  return new URL(publicOrigin(env)).host;
}

export const fedAddress = (handle: string, env: NodeJS.ProcessEnv = process.env) => `${handle}@${instanceDomain(env)}`;
