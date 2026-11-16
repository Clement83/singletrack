import type { Auth } from './auth';

/** Crée un compte en CLI (#1344, #1377) : pas de mot de passe, la personne se connecte avec le code reçu par mail. */
export async function createUser(auth: Auth, input: { email: string; name: string }) {
  const ctx = await auth.$context;
  const email = input.email.trim().toLowerCase();
  if (await ctx.internalAdapter.findUserByEmail(email)) throw new Error(`Un compte existe déjà pour ${email}`);
  return ctx.internalAdapter.createUser({ email, name: input.name.trim(), emailVerified: true }, { method: 'admin' });
}
