// Utilitaires partagés des spikes chasse (#1572). Jetable : exclu de tsc/ESLint/image.
export const UA = 'Mozilla/5.0 (compatible; singletrack-poc)';
export const VAR_BBOX = { minLon: 5.65, maxLon: 6.95, minLat: 42.98, maxLat: 43.80 };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}
export function bbox(geom) {
  const rings = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let [a, b, c, d] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of rings) for (const ring of poly) for (const [x, y] of ring) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return { minLon: a, minLat: b, maxLon: c, maxLat: d };
}
export const inVarBox = (g) => { const b = bbox(g); return b.maxLon >= VAR_BBOX.minLon && b.minLon <= VAR_BBOX.maxLon && b.maxLat >= VAR_BBOX.minLat && b.minLat <= VAR_BBOX.maxLat; };
