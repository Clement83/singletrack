// Sync of the OSM singletrack layer (#1372, whole of France #1428):  npm run sync:singles [-- 83 06 2A]
// One Overpass request per department (path/track ways with mtb:scale), sequential; without arguments = all of France.
// Each area is replaced as a whole (idempotent); a failing area keeps its old layer and does not stop the others.
// No IGN elevation (useless for a layer). Never called from a page.
import { getDb } from '../src/db';
import { config, sourceEnabled } from '../src/lib/config';
import { fetchSingles, parseZones } from '../src/lib/osm';
import { replaceSegments } from '../src/lib/osm/singles-store';
import { trailSegment } from '../src/db/schema';
import { eq, sql } from 'drizzle-orm';

async function main() {
  if (!sourceEnabled('osm')) {
    console.log('Source "osm" disabled (DATA_SOURCES): nothing to do.');
    return;
  }
  const { db, sqlite } = getDb();
  const { zones, invalid } = parseZones(process.argv.slice(2), config.syncZones);
  if (invalid.length) console.error(`Areas ignored (not a metropolitan department): ${invalid.join(', ')}`);
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
        console.warn(`[${i + 1}/${zones.length}] ${code}: empty answer while ${before} segments exist — area kept`);
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
  console.log(`Done in ${Math.round((Date.now() - t0) / 60000)} min: ${total} singletracks (${Math.round(km)} km).`);
  if (failed.length) console.error(`Failed areas (run again: npm run sync:singles -- ${failed.join(' ')}): ${failed.join(', ')}`);
  if (failed.length === zones.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
