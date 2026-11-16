// Niveaux de risque incendie (#1349) :  npm run sync:fire [-- 2026-08-15 …]   (dans le conteneur `app`)
// Sans argument : passe normale (aujourd'hui + demain, avec les mêmes garde-fous que le planificateur).
// Avec des dates : récupère ces jours-là, sans condition (une requête par date).
import { getDb } from '../src/db';
import { isDateStr } from '../src/lib/fire/dates';
import { fetchDay } from '../src/lib/fire/store';
import { refreshFire } from '../src/lib/fire/refresh';

async function main() {
  const { db } = getDb();
  const dates = process.argv.slice(2).filter(isDateStr);
  if (!dates.length) return console.log('Fait :', (await refreshFire(db)).join(', ') || 'rien à faire');
  for (const d of dates) console.log(d, await fetchDay(db, d));
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
