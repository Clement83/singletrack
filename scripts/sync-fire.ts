// Fire risk levels (#1349):  npm run sync:fire [-- 2026-08-15 …]   (in a container)
// Without arguments: normal pass (today + tomorrow, with the same safeguards as the scheduler).
// With dates: fetches those days, unconditionally (one request per date).
import { getDb } from '../src/db';
import { isDateStr } from '../src/lib/fire/dates';
import { fetchDay } from '../src/lib/fire/store';
import { refreshFire } from '../src/lib/fire/refresh';

async function main() {
  const { db } = getDb();
  const dates = process.argv.slice(2).filter(isDateStr);
  if (!dates.length) return console.log('Done:', (await refreshFire(db)).join(', ') || 'nothing to do');
  for (const d of dates) console.log(d, await fetchDay(db, d));
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
