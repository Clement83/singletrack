import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from './auth';

/**
 * Single entry point to know "who is signed in": if auth changes (e.g. an Authelia `Remote-User`
 * header at exposure, #1339), only this file has to change.
 */
export async function getCurrentUser() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/** Private pages and layouts: redirects to /login without a session. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Non connecté');
  }
}

/** Write Server Actions and Route Handlers: throws UnauthorizedError (to translate into 401). */
export async function assertUser() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Standard 401 response for private Route Handlers: `try { await assertUser() } catch (e) { return unauthorized(e) }`. */
export function unauthorized(e: unknown) {
  if (e instanceof UnauthorizedError) return Response.json({ error: 'unauthorized' }, { status: 401 });
  throw e;
}
