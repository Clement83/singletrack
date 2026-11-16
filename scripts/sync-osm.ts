// Synchro des itinéraires VTT OpenStreetMap (#1336, France entière #1428) :  npm run sync:osm [-- 83 06 2A]  (sans argument : SYNC_ZONES, sinon toute la France)
// Une requête Overpass par département (séquentielle), sans argument = toute la France métropolitaine.
// Idempotent : upsert sur (osm, relation/<id>), slugs conservés. Une zone en échec n'arrête pas les autres.
// Pas d'altitude IGN en masse : elle est calculée à la première ouverture d'une trace (#1428).
import { getDb } from '../src/db';
import { config, sourceEnabled } from '../src/lib/config';
import { osmSource, parseZones } from '../src/lib/osm';
import { regionFromConfig, syncSource } from '../src/lib/tracks';

async function main() {
  if (!sourceEnabled('osm')) {
    console.log('Source « osm » désactivée (DATA_SOURCES) : rien à faire.');
    return;
  }
  const { db } = getDb();
  const { zones, invalid } = parseZones(process.argv.slice(2), config.syncZones);
  if (invalid.length) console.error(`Zones ignorées (pas un département métropolitain) : ${invalid.join(', ')}`);
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
      console.log(`[${i + 1}/${zones.length}] ${code} : ${r.created} créées, ${r.updated} mises à jour, ${r.failed} en erreur (${Math.round((Date.now() - z0) / 1000)} s)`);
    } catch (e) {
      failedZones.push(code);
      console.error(`[${i + 1}/${zones.length}] ${code} : ÉCHEC — ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Terminé en ${Math.round((Date.now() - t0) / 60000)} min : ${total.created} créées, ${total.updated} mises à jour, ${total.failed} en erreur.`);
  if (failedZones.length) console.error(`Zones en échec (relancer : npm run sync:osm -- ${failedZones.join(' ')}) : ${failedZones.join(', ')}`);
  if (failedZones.length === zones.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
