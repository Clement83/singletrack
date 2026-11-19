// Sample database of the smoke test (#1482): one public track, reachable without an account through /t/<slug>.
// Usage (in the image): DATABASE_URL=... npx tsx scripts/smoke-seed.ts  → prints the slug.
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
