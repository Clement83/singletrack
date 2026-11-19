// Routing bench #1385: mtb vs singletrack vs singletrack-vae on real pairs (start → highest point of the tracks).
import Database from 'better-sqlite3';
const db = new Database('data/singletrack.db', { readonly: true });
const rows = db.prepare("select name, geometry from track where source in ('osm','geotrek') and max_ele - min_ele > 150 order by distance_m limit 40").all();
const R = 6371000, rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => { const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const pairs = [];
for (const r of rows) {
  const g = JSON.parse(r.geometry); const c = g.type === 'LineString' ? g.coordinates : g.coordinates.flat();
  const hi = c.reduce((m, p) => (p[2] > m[2] ? p : m), c[0]); const lo = c.reduce((m, p) => (p[2] < m[2] ? p : m), c[0]);
  const d = hav(lo, hi); if (d < 2500 || d > 7000) continue;
  pairs.push({ name: r.name, lo, hi }); if (pairs.length >= 5) break;
}
async function route(a, b, profile) {
  const t0 = Date.now();
  const u = `${process.env.BROUTER_URL}/brouter?lonlats=${a[0]},${a[1]}|${b[0]},${b[1]}&profile=${profile}&alternativeidx=0&format=geojson`;
  const r = await fetch(u); if (!r.ok) return { err: (await r.text()).slice(0, 60) };
  const j = await r.json(); const p = j.features[0].properties;
  return { km: +(p['track-length'] / 1000).toFixed(2), up: +p['filtered ascend'], down: -(+p['plain-ascend'] - +p['filtered ascend']) || null, ms: Date.now() - t0 };
}
for (const pr of pairs) {
  for (const [dir, a, b] of [['climb', pr.lo, pr.hi], ['descent', pr.hi, pr.lo]]) {
    const out = {};
    for (const prof of ['mtb', 'singletrack', 'singletrack-vae']) out[prof] = await route(a, b, prof);
    console.log(JSON.stringify({ trace: pr.name, dir, from: a.slice(0, 2).map((x) => +x.toFixed(4)), to: b.slice(0, 2).map((x) => +x.toFixed(4)), ...out }));
  }
}
