import { assertUser, UnauthorizedError } from './current-user';
import { isAdminEmail } from './federation/moderation';

export class ForbiddenError extends Error {
  constructor() { super('Réservé à l’administrateur'); }
}

/** Admin routes and pages (#1477): session required **and** email in `ADMIN_EMAILS`. */
export async function assertAdmin() {
  const user = await assertUser();
  if (!isAdminEmail(user.email)) throw new ForbiddenError();
  return user;
}

/** 401 without a session, 403 for an account that is not an admin. */
export function adminDenied(e: unknown) {
  if (e instanceof UnauthorizedError) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if (e instanceof ForbiddenError) return Response.json({ error: 'forbidden' }, { status: 403 });
  throw e;
}
