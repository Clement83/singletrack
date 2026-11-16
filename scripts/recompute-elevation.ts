// Recalcul du D+ de l'existant (#1519) :  npm run elevation:recompute [-- --dry-run] [--force] [--no-backup]
// Recote par l'IGN (remplacement, #1515) puis recalcule D+/D-/min/max (#1517) des traces, des snapshots de sorties
// (passées comprises) et des traces roulées. Sorties distantes non concernées.
//  - SAUVEGARDE : avant toute écriture, copie cohérente de la base dans <dossier de la base>/backups/ (sauf --dry-run / --no-backup).
//  - IDEMPOTENT : une ligne n'est réécrite que si le résultat diffère ; une seconde exécution ne change rien.
//  - REPRISE : les lignes traitées sont consignées dans <dossier de la base>/elevation-recompute.state (une clé par ligne) ;
//    relancer après interruption continue là où l'on s'était arrêté. `--force` repart de zéro (efface ce fichier).
//  - QUOTA IGN : 5 req/s respectés par enrichElevation (pause de 220 ms entre requêtes, cache par point).
//  - JOURNAL : une ligne par échec, puis le total traités / modifiés / ignorés / en échec. Code de sortie 1 s'il y a des échecs.
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../src/db';
import { recomputeElevation } from '../src/lib/tracks/recompute-elevation';

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const { db, sqlite } = getDb();
  const dir = path.dirname(sqlite.name);
  const statePath = path.join(dir, 'elevation-recompute.state');

  if (!dryRun && !args.has('--no-backup')) {
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    const dest = path.join(dir, 'backups', `singletrack-avant-elevation-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    await sqlite.backup(dest);
    console.log(`Sauvegarde : ${dest}`);
  }
  if (args.has('--force') && fs.existsSync(statePath)) fs.rmSync(statePath);
  const done = new Set<string>(fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8').split('\n').filter(Boolean) : []);
  if (done.size) console.log(`Reprise : ${done.size} lignes déjà traitées (--force pour tout refaire).`);

  const report = await recomputeElevation(db, {
    done,
    dryRun,
    onProgress: (k) => fs.appendFileSync(statePath, `${k}\n`),
    onItem: (kind, id, outcome, detail) => {
      if (outcome === 'failed') console.error(`ÉCHEC ${kind} ${id} : ${detail}`);
      else if (outcome === 'changed') console.log(`${dryRun ? '[dry-run] ' : ''}modifié ${kind} ${id}`);
    },
  });
  let failed = 0;
  for (const [kind, r] of Object.entries(report)) {
    failed += r.failed;
    console.log(`${kind} : ${r.seen} vus, ${r.changed} modifiés, ${r.skipped} ignorés, ${r.failed} en échec`);
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
