/**
 * Clustering of the map's outings at low zoom (#1461): grid proportional to the zoom (≈ 110 px per cell),
 * pure and tested. At zoom `CLUSTER_BELOW` and above, every outing stays alone.
 */
export const OUTING_CLUSTER_BELOW = 11;

export type Pt = { id: string; lat: number; lon: number };
export type OutingCluster<T extends Pt> = { key: string; lat: number; lon: number; items: T[] };

export function clusterOutings<T extends Pt>(items: T[], zoom: number): OutingCluster<T>[] {
  if (zoom >= OUTING_CLUSTER_BELOW) return items.map((i) => ({ key: i.id, lat: i.lat, lon: i.lon, items: [i] }));
  const cell = (360 / 2 ** zoom) * (110 / 256);
  const cells = new Map<string, T[]>();
  for (const i of items) {
    const k = `${Math.floor(i.lon / cell)}:${Math.floor(i.lat / cell)}`;
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(i);
  }
  return [...cells.entries()].map(([k, list]) => ({
    key: list.length === 1 ? list[0].id : `c${k}`,
    lat: list.reduce((s, i) => s + i.lat, 0) / list.length,
    lon: list.reduce((s, i) => s + i.lon, 0) / list.length,
    items: list,
  }));
}
