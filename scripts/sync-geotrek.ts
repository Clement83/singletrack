// Sync of the official Geotrek mountain-bike routes (#1347, several instances #1428):  npm run sync:geotrek [-- var ecrins]
// One instance after another (list in src/lib/geotrek/instances.ts); without arguments = all of them.
// Idempotent: upsert on (geotrek, <instance>/<id>), slugs kept. A failing instance does not stop the others.
// Elevation comes from Geotrek (3D geometry); no bulk IGN completion (#1428).
import { getDb } from '../src/db';
import { sourceEnabled } from '../src/lib/config';
import { geotrekSource, parseInstances } from '../src/lib/geotrek';
import { regionFromConfig, syncSource } from '../src/lib/tracks';

async function main() {
  if (!sourceEnabled('geotrek')) {
    console.log('Source "geotrek" disabled (DATA_SOURCES): nothing to do.');
    return;
  }
  const { db } = getDb();
  const { instances, invalid } = parseInstances(process.argv.slice(2));
  if (invalid.length) console.error(`Instances inconnues : ${invalid.join(', ')}`);
  const region = regionFromConfig();
  const failed: string[] = [];
  for (const instance of instances) {
    console.log(`Synchro Geotrek « ${instance.id} » (${instance.apiBase})…`);
    try {
      const r = await syncSource(db, geotrekSource({ instance }), region, { enrich: false }, (e, t) =>
        console.error(`  ✗ ${t.externalId} « ${t.name} » : ${e instanceof Error ? e.message : e}`),
      );
      console.log(`  ${instance.id}: ${r.created} created, ${r.updated} updated, ${r.failed} failed.`);
    } catch (e) {
      failed.push(instance.id);
      console.error(`  ${instance.id} : ÉCHEC — ${e instanceof Error ? e.message : e}`);
    }
  }
  if (failed.length) console.error(`Failed instances: ${failed.join(', ')}`);
  if (instances.length === 0 || failed.length === instances.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
