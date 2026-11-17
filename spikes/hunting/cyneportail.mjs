// CynePortail (#1572) : 1 appel (GeoJSON ~10 Mo, toutes les battues déclarées des 30 jours).
// Usage : node cyneportail.mjs [AAAA-MM-JJ]  — rien n'est écrit sur disque.
import { getJson, inVarBox, bbox } from './common.mjs';
const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const d = await getJson('https://www.cyneportail.fr/declarations/timeline/geojson');
const f = d.features;
const all = f.flatMap((x) => x.properties.battue_dates);
const bb = f.map((x) => bbox(x.geometry));
console.log('lots', f.length, 'communes', new Set(f.map((x) => x.properties.commune)).size, 'circonscriptions', new Set(f.map((x) => x.properties.circonscription)).size);
console.log('emprise lon', Math.min(...bb.map((b) => b.minLon)).toFixed(2), Math.max(...bb.map((b) => b.maxLon)).toFixed(2), 'lat', Math.min(...bb.map((b) => b.minLat)).toFixed(2), Math.max(...bb.map((b) => b.maxLat)).toFixed(2));
console.log('dates de battue', all.sort()[0], '→', all.sort().at(-1));
console.log('lots dans le Var :', f.filter((x) => inVarBox(x.geometry)).length);
const today = f.filter((x) => x.properties.battue_dates.includes(date));
console.log(`battues le ${date} :`, today.length, 'lots, ex.', today.slice(0, 3).map((x) => `${x.properties.commune} / ${x.properties.name}`));
