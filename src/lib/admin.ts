import { assertUser, UnauthorizedError } from './current-user';
import { isAdminEmail } from './federation/moderation';

export class ForbiddenError extends Error {
  constructor() { super('Réservé à l’administrateur'); }
}

/** Routes et pages d'administration (#1477) : session obligatoire **et** email dans `ADMIN_EMAILS`. */
export async function assertAdmin() {
  const user = await assertUser();
  if (!isAdminEmail(user.email)) throw new ForbiddenError();
  return user;
}

/** 401 sans session, 403 pour un compte qui n'est pas admin. */
export function adminDenied(e: unknown) {
  if (e instanceof UnauthorizedError) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (e instanceof ForbiddenError) return Response.json({ error: 'forbidden' }, { status: 403 });
  throw e;
}
