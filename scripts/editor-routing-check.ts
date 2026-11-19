// Fixtures and integration test of the editor's routing (#1522), against the compose's real BRouter.
//   docker compose exec app-dev npx tsx scripts/editor-routing-check.ts            # replays every fixture and checks the real BRouter
//   docker compose exec app-dev npx tsx scripts/editor-routing-check.ts --record   # (re)records tests/fixtures/brouter/segments.json
// Area: the owner's tracks around Toulon / Collobrières ("tutu (copie)", "vers la reserve d'eau collo",
// "Lac de la verne"), plus points placed exactly on a computed route (magnet case).
import fs from 'node:fs';
import path from 'node:path';
import { routeScored } from '../src/lib/routing/brouter';
import { haversine } from '../src/lib/geo';

type LL = [number, number];
const FILE = path.join('tests', 'fixtures', 'brouter', 'segments.json');
const RIDER = 'muscle' as const;

// Waypoints taken from the owner's tracks (rounded to 6 decimals).
const TUTU: LL[] = [[6.146258, 43.220087], [6.158456, 43.218528], [6.168217, 43.219942], [6.172476, 43.220576], [6.174178, 43.219976], [6.17428, 43.226758], [6.180227, 43.223414]];
const COLLO: LL[] = [[6.145802, 43.220302], [6.167908, 43.219957], [6.175033, 43.226521], [6.189232, 43.220967]];
const VERNE: LL[] = [[6.355849, 43.237943], [6.343349, 43.220124], [6.337382, 43.217243], [6.338641, 43.213932]];

const pairs = (l: LL[]) => l.slice(1).map((to, i) => [l[i], to] as [LL, LL]);
type Seg = { from: LL; to: LL; coordinates: number[][]; alternatives: { coordinates: number[][]; deltaKm: number; quality: string }[]; note: unknown };

async function route(from: LL, to: LL): Promise<Seg> {
  const r = await routeScored(from, to, RIDER);
  return {
    from, to, coordinates: r.best.coordinates,
    alternatives: r.alternatives.map((a) => ({ coordinates: a.coordinates, deltaKm: a.deltaKm, quality: a.quality })), note: r.note,
  };
}

async function main() {
  if (process.argv.includes('--record')) {
    const out: Seg[] = [];
    for (const [a, b] of [...pairs(TUTU), ...pairs(COLLO), ...pairs(VERNE)]) out.push(await route(a, b));
    // Points placed EXACTLY on a route: inner vertices of a computed segment.
    const base = out[0].coordinates;
    const on = (k: number) => [base[Math.floor((base.length * k) / 4)][0], base[Math.floor((base.length * k) / 4)][1]] as LL;
    const [p1, p2, p3] = [on(1), on(2), on(3)];
    for (const [a, b] of [[p1, p2], [p2, p3], [p3, out[0].to]] as [LL, LL][]) out.push(await route(a, b));
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(out));
    console.log(`${out.length} segments recorded in ${FILE} (${Math.round(fs.statSync(FILE).size / 1024)} KB)`);
    return;
  }
  const fixtures = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Seg[];
  let bad = 0;
  for (const f of fixtures) {
    const live = await route(f.from, f.to);
    const ends = haversine(live.coordinates[0] as never, f.from as never) < 150 && haversine(live.coordinates.at(-1)! as never, f.to as never) < 150;
    const same = Math.abs(live.coordinates.length - f.coordinates.length) <= Math.max(5, f.coordinates.length * 0.2);
    if (!ends) bad++;
    console.log(`${ends ? 'ok ' : 'KO '} ${f.from} → ${f.to} : ${live.coordinates.length} pts, ${live.alternatives.length} alt.${same ? '' : ' (route differs from the fixture, record again?)'}`);
  }
  if (bad) {
    console.error(`${bad} segment(s) do not connect their end points`);
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
