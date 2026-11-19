import type { Auth } from './auth';

/** Creates an account from the CLI (#1344, #1377): no password, the person signs in with the code received by email. */
export async function createUser(auth: Auth, input: { email: string; name: string }) {
  const ctx = await auth.$context;
  const email = input.email.trim().toLowerCase();
  if (await ctx.internalAdapter.findUserByEmail(email)) throw new Error(`Un compte existe déjà pour ${email}`);
  return ctx.internalAdapter.createUser({ email, name: input.name.trim(), emailVerified: true }, { method: 'admin' });
}
