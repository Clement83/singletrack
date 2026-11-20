/** Pure helpers for the start-point cluster markers (#1688): difficulty aggregation and pie ring geometry. */

export const RING_KEYS = ['green', 'blue', 'red', 'black', 'none'] as const;
export type RingKey = (typeof RING_KEYS)[number];
export type Counts = Record<RingKey, number>;

/** MapLibre `clusterProperties` (aggregated server-side by the GeoJSON source) — one counter per difficulty. */
export const CLUSTER_PROPERTIES: Record<string, unknown> = Object.fromEntries(
  RING_KEYS.map((k) => [`n_${k}`, ['+', ['case', ['==', ['get', 'difficulty'], k], 1, 0]]]),
);

/** Reads the counters of a cluster feature; missing/invalid ⇒ 0. */
export function countsOf(props: Record<string, unknown> | null | undefined): Counts {
  const n = (k: RingKey) => {
    const v = Number(props?.[`n_${k}`]);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  };
  return { green: n('green'), blue: n('blue'), red: n('red'), black: n('black'), none: n('none') };
}

export const totalOf = (c: Counts) => RING_KEYS.reduce((s, k) => s + c[k], 0);

export type Arc = { key: RingKey; count: number; d: string };

/** SVG path of an annulus sector, angles in radians from 12 o'clock, clockwise. */
function sector(cx: number, cy: number, r: number, w: number, a0: number, a1: number): string {
  const ro = r + w / 2;
  const ri = r - w / 2;
  const pt = (rad: number, a: number) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)].map((v) => +v.toFixed(2));
  const [x0, y0] = pt(ro, a0);
  const [x1, y1] = pt(ro, a1);
  const [x2, y2] = pt(ri, a1);
  const [x3, y3] = pt(ri, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0} ${y0}A${ro} ${ro} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${ri} ${ri} 0 ${large} 0 ${x3} ${y3}Z`;
}

/** Ring arcs, proportional to counts; a single difficulty gives a full ring (two half arcs to stay valid in SVG). */
export function ringArcs(counts: Counts, size: number, thickness: number): Arc[] {
  const total = totalOf(counts);
  if (total <= 0) return [];
  const c = size / 2;
  const r = c - thickness / 2;
  const arcs: Arc[] = [];
  let a = 0;
  for (const key of RING_KEYS) {
    const count = counts[key];
    if (!count) continue;
    const span = (count / total) * Math.PI * 2;
    if (span >= Math.PI * 2 - 1e-6) {
      arcs.push({ key, count, d: sector(c, c, r, thickness, 0, Math.PI) + sector(c, c, r, thickness, Math.PI, Math.PI * 2 - 1e-4) });
    } else {
      arcs.push({ key, count, d: sector(c, c, r, thickness, a, a + span) });
    }
    a += span;
  }
  return arcs;
}

/** Marker diameter in px, growing moderately (log) with the count: 36 → 56. */
export function clusterSize(count: number): number {
  return Math.round(Math.min(56, 36 + 8 * Math.log10(Math.max(1, count)) * 1.5));
}

/** Compact label: 1234 ⇒ "1.2k". */
export function countLabel(n: number): string {
  return n >= 1000 ? `${(Math.floor(n / 100) / 10).toString()}k` : String(n);
}
