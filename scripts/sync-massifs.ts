// Contours des massifs du Var (#1349) :  npm run sync:massifs   (dans le conteneur `app`)
// À lancer au plus une fois par saison ; recalcule aussi les massifs traversés par chaque trace.
import { getDb } from '../src/db';
import { syncMassifs } from '../src/lib/fire/refresh';

syncMassifs(getDb().db)
  .then((r) => console.log(`${r.massifs} massifs importés, ${r.tracks} traces recalculées.`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
