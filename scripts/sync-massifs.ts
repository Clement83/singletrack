// Outlines of the Var forest massifs (#1349):  npm run sync:massifs   (in a container)
// Run at most once per season; also recomputes the massifs crossed by each track.
import { getDb } from '../src/db';
import { syncMassifs } from '../src/lib/fire/refresh';

syncMassifs(getDb().db)
  .then((r) => console.log(`${r.massifs} massifs imported, ${r.tracks} tracks recomputed.`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
