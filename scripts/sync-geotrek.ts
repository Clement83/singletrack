// Synchro des circuits VTT officiels Geotrek (#1347, plusieurs instances #1428) :  npm run sync:geotrek [-- var ecrins]
// Une instance après l'autre (liste dans src/lib/geotrek/instances.ts) ; sans argument = toutes.
// Idempotent : upsert sur (geotrek, <instance>/<id>), slugs conservés. Une instance en échec n'arrête pas les autres.
// L'altitude vient de Geotrek (géométrie 3D) ; pas de complément IGN en masse (#1428).
import { getDb } from '../src/db';
import { sourceEnabled } from '../src/lib/config';
import { geotrekSource, parseInstances } from '../src/lib/geotrek';
import { regionFromConfig, syncSource } from '../src/lib/tracks';

async function main() {
  if (!sourceEnabled('geotrek')) {
    console.log('Source « geotrek » désactivée (DATA_SOURCES) : rien à faire.');
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
      console.log(`  ${instance.id} : ${r.created} créées, ${r.updated} mises à jour, ${r.failed} en erreur.`);
    } catch (e) {
      failed.push(instance.id);
      console.error(`  ${instance.id} : ÉCHEC — ${e instanceof Error ? e.message : e}`);
    }
  }
  if (failed.length) console.error(`Instances en échec : ${failed.join(', ')}`);
  if (instances.length === 0 || failed.length === instances.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
