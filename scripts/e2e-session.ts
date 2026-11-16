// Session de test des tests de bout en bout (#1523) : crée (ou réutilise) le compte `e2e@singletrack.test`, une session
// valide et écrit le `storageState` Playwright (`e2e/.auth/state.json`). Aucun vrai mail : la session est posée en base.
// Les traces de ce compte sont supprimées à chaque lancement (jeu de test propre).
// Usage (conteneur app, via le service compose `e2e-session`) : npx tsx scripts/e2e-session.ts
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db';
import * as schema from '../src/db/schema';
import { createAuth } from '../src/lib/auth';
import { createUser } from '../src/lib/users';
import { LOCALE_COOKIE } from '../src/i18n/config';

const EMAIL = 'e2e@singletrack.test';
const baseUrl = new URL(process.env.E2E_BASE_URL ?? 'http://app-e2e:3000');

async function main() {
  const { db } = getDb();
  const auth = createAuth(db);
  const ctx = await auth.$context;
  let user = await ctx.internalAdapter.findUserByEmail(EMAIL).then((r) => r?.user);
  if (!user) user = await createUser(auth, { email: EMAIL, name: 'Testeur' });

  db.delete(schema.track).where(eq(schema.track.createdBy, user.id)).run();
  db.delete(schema.session).where(eq(schema.session.userId, user.id)).run();

  const session = await ctx.internalAdapter.createSession(user.id);
  // Cookie signé comme Better Auth : `<jeton>.<HMAC-SHA256 base64>`, encodé pour l'en-tête Cookie.
  const sig = createHmac('sha256', ctx.secret).update(session.token).digest('base64');
  const value = encodeURIComponent(`${session.token}.${sig}`);
  const cookie = (name: string, v: string) => ({
    name, value: v, domain: baseUrl.hostname, path: '/', expires: Math.floor(Date.now() / 1000) + 86_400,
    httpOnly: true, secure: ctx.authCookies.sessionToken.attributes.secure ?? false, sameSite: 'Lax' as const,
  });
  const state = { cookies: [cookie(ctx.authCookies.sessionToken.name, value), { ...cookie(LOCALE_COOKIE, 'fr'), httpOnly: false }], origins: [] };
  const out = path.join(process.cwd(), 'e2e', '.auth', 'state.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(state, null, 2));
  console.log(`Session de test écrite : ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
