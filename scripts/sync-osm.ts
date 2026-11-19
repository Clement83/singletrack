// Sync of the OpenStreetMap mountain-bike routes (#1336, whole of France #1428):  npm run sync:osm [-- 83 06 2A]  (without arguments: SYNC_ZONES, otherwise all of France)
// One Overpass request per department (sequential), without arguments = all of metropolitan France.
// Idempotent: upsert on (osm, relation/<id>), slugs kept. A failing area does not stop the others.
// No bulk IGN elevation: it is computed the first time a track is opened (#1428).
import { getDb } from '../src/db';
import { config, sourceEnabled } from '../src/lib/config';
import { osmSource, parseZones } from '../src/lib/osm';
import { regionFromConfig, syncSource } from '../src/lib/tracks';

async function main() {
  if (!sourceEnabled('osm')) {
    console.log('Source "osm" disabled (DATA_SOURCES): nothing to do.');
    return;
  }
  const { db } = getDb();
  const { zones, invalid } = parseZones(process.argv.slice(2), config.syncZones);
  if (invalid.length) console.error(`Areas ignored (not a metropolitan department): ${invalid.join(', ')}`);
  const base = regionFromConfig();
  const t0 = Date.now();
  const total = { created: 0, updated: 0, failed: 0 };
  const failedZones: string[] = [];
  for (const [i, code] of zones.entries()) {
    const z0 = Date.now();
    try {
      const r = await syncSource(db, osmSource(), { ...base, code }, { enrich: false }, (e, t) =>
        console.error(`  ✗ ${t.externalId} « ${t.name} » : ${e instanceof Error ? e.message : e}`),
      );
      total.created += r.created; total.updated += r.updated; total.failed += r.failed;
      console.log(`[${i + 1}/${zones.length}] ${code}: ${r.created} created, ${r.updated} updated, ${r.failed} failed (${Math.round((Date.now() - z0) / 1000)} s)`);
    } catch (e) {
      failedZones.push(code);
      console.error(`[${i + 1}/${zones.length}] ${code} : ÉCHEC — ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Done in ${Math.round((Date.now() - t0) / 60000)} min: ${total.created} created, ${total.updated} updated, ${total.failed} failed.`);
  if (failedZones.length) console.error(`Failed areas (run again: npm run sync:osm -- ${failedZones.join(' ')}): ${failedZones.join(', ')}`);
  if (failedZones.length === zones.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
