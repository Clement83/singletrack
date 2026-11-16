import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from './auth';

/**
 * Seule porte d'entrée pour savoir « qui est connecté » : si l'auth change (ex. en-tête Authelia
 * `Remote-User` à l'exposition, #1339), seul ce fichier est à adapter.
 */
export async function getCurrentUser() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/** Pages et layouts privés : redirige vers /login sans session. */
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

/** Server Actions et Route Handlers d'écriture : lève UnauthorizedError (à traduire en 401). */
export async function assertUser() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Réponse 401 standard pour les Route Handlers privés : `try { await assertUser() } catch (e) { return unauthorized(e) }`. */
export function unauthorized(e: unknown) {
  if (e instanceof UnauthorizedError) return Response.json({ error: 'unauthorized' }, { status: 401 });
  throw e;
}
