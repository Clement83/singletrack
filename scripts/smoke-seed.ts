// Base d'exemple du test de fumée (#1482) : une trace publique, affichée sans compte sur /t/<slug>.
// Usage (dans l'image) : DATABASE_URL=... npx tsx scripts/smoke-seed.ts  → imprime le slug.
import { getDb } from '../src/db';
import { upsertTrack } from '../src/lib/tracks';

async function main() {
  const coordinates = Array.from({ length: 40 }, (_, i) => [6.14 + i * 0.001, 43.22 + (i % 3) * 0.0005, 100 + i * 2] as [number, number, number]);
  const t = await upsertTrack(getDb().db, {
    source: 'osm', externalId: 'smoke-1', name: 'Boucle de fumée', license: 'ODbL', attribution: '© OpenStreetMap contributors',
    geometry: { type: 'LineString', coordinates }, raw: {},
  }, { enrich: false });
  console.log(t.slug);
}

main().catch((e) => { console.error(e); process.exit(1); });
