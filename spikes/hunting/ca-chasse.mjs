// Ça chasse ? (#1572) : 3 appels, dates J, J+30, J+60. Usage : node ca-chasse.mjs
import { getJson, sleep, inVarBox } from './common.mjs';
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
for (const n of [0, 30, 60]) {
  const d = await getJson(`https://ca-chasse.com/api/today?date=${day(n)}`);
  const f = d.geojson.features;
  console.log(day(n), 'zones actives', d.summary.activeZones, 'territoires', d.summary.activeTerritories, 'features', f.length,
    'dans le Var', f.filter((x) => inVarBox(x.geometry)).length, 'territoires:', [...new Set(f.map((x) => x.properties.territoire || x.properties.nom))].join(', '));
  await sleep(1500);
}
