// Synchro du calque des singles OSM (#1372, France entière #1428) :  npm run sync:singles [-- 83 06 2A]
// Une requête Overpass par département (ways path/track avec mtb:scale), séquentielle ; sans argument = toute la France.
// Chaque zone est remplacée en bloc (idempotent) ; une zone en échec garde son ancien calque et n'arrête pas les autres.
// Pas d'altitude IGN (inutile pour un calque). Jamais appelée depuis une page.
import { getDb } from '../src/db';
import { config, sourceEnabled } from '../src/lib/config';
import { fetchSingles, parseZones } from '../src/lib/osm';
import { replaceSegments } from '../src/lib/osm/singles-store';
import { trailSegment } from '../src/db/schema';
import { eq, sql } from 'drizzle-orm';

async function main() {
  if (!sourceEnabled('osm')) {
    console.log('Source « osm » désactivée (DATA_SOURCES) : rien à faire.');
    return;
  }
  const { db, sqlite } = getDb();
  const { zones, invalid } = parseZones(process.argv.slice(2), config.syncZones);
  if (invalid.length) console.error(`Zones ignorées (pas un département métropolitain) : ${invalid.join(', ')}`);
  const t0 = Date.now();
  let total = 0;
  let km = 0;
  const failed: string[] = [];
  for (const [i, code] of zones.entries()) {
    const z0 = Date.now();
    try {
      const segments = await fetchSingles(code);
      const before = db.select({ n: sql<number>`count(*)` }).from(trailSegment).where(eq(trailSegment.zone, code)).get()?.n ?? 0;
      if (segments.length === 0 && before > 0) {
        console.warn(`[${i + 1}/${zones.length}] ${code} : réponse vide alors que ${before} segments existent — zone conservée`);
        continue;
      }
      replaceSegments(db, segments, new Date(), code);
      total += segments.length;
      km += segments.reduce((s, x) => s + x.lengthM, 0) / 1000;
      console.log(`[${i + 1}/${zones.length}] ${code} : ${segments.length} singles (${Math.round((Date.now() - z0) / 1000)} s)`);
    } catch (e) {
      failed.push(code);
      console.error(`[${i + 1}/${zones.length}] ${code} : ÉCHEC — ${e instanceof Error ? e.message : e}`);
    }
  }
  sqlite.pragma('optimize');
  console.log(`Terminé en ${Math.round((Date.now() - t0) / 60000)} min : ${total} singles (${Math.round(km)} km).`);
  if (failed.length) console.error(`Zones en échec (relancer : npm run sync:singles -- ${failed.join(' ')}) : ${failed.join(', ')}`);
  if (failed.length === zones.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
