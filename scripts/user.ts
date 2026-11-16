// CLI comptes (#1344, #1377) — connexion sans mot de passe : la personne reçoit un code par mail.
//   npm run user:create -- --email a@b.fr --name Clément
import { parseArgs } from 'node:util';
import { getDb } from '../src/db';
import { createAuth } from '../src/lib/auth';
import { createUser } from '../src/lib/users';

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({ args: rest, options: { email: { type: 'string' }, name: { type: 'string' } } });
  if (cmd !== 'create' || !values.email || !values.name) {
    console.error('Usage : user.ts create --email E --name N');
    process.exit(2);
  }
  const { db } = getDb();
  const u = await createUser(createAuth(db), { email: values.email, name: values.name });
  console.log(`Compte créé : ${u.email} (connexion par code reçu par mail)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
