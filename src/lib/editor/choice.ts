import { haversine, type Position } from '@/lib/geo';
import { segmentLine, type EditorDoc, type LonLat, type Segment } from './doc';
import { liveStats, type LiveStats } from './stats';
import type { AltSet } from './alts';

/**
 * Detour on drag that "also bypasses hand-placed points" (#1641).
 *
 * After a drag (point or line) towards a nearby road, we route upstream anchor → dragged point → downstream anchor, where the
 * anchors are waypoints **far enough** away (caps below). Comparing this line with the old one gives the
 * divergence and the rejoin; the waypoints between them are removed in the "new" option only.
 * "Old" is the document from before the drag, strictly unchanged. Everything is pure: routing is provided by the caller.
 */
/** Cap (m) of line walked on each side to look for an anchor; beyond it, back to the #1451 behaviour. */
export const CHOICE_MAX_M = 3000;
/** Cap of waypoints crossed on each side. */
export const CHOICE_MAX_POINTS = 12;
/** Tolerance (m) to say that a point of the new line "follows" the old one: 8 m covers the gap between two BRouter computations on the same paths. */
export const CHOICE_TOL_M = 8;

/** Detour gesture waiting to be widened (set by the `deviate` action). */
export type PendingDeviation = {
  /** Document from before the drag (= "old" option). */
  before: EditorDoc;
  /** Previous document, with the inserted point if it was a line drag: used for the computation. */
  base: EditorDoc;
  /** Index of the dragged point in `base`. */
  i: number;
  p: LonLat;
  /** True if `base` has one more point than `before` (line drag). */
  inserted: boolean;
};

export type WidenPlan = { up: number | null; down: number | null };

const segLen = (doc: EditorDoc, k: number) => {
  const c = segmentLine(doc, k);
  let s = 0;
  for (let j = 1; j < c.length; j++) s += haversine(c[j - 1], c[j]);
  return s;
};

/** Far anchors to route (indices in `base`), or `null` if the usual behaviour is enough. */
export function planWiden(p: PendingDeviation, maxM = CHOICE_MAX_M, maxPts = CHOICE_MAX_POINTS): WidenPlan | null {
  const { base, i } = p;
  const n = base.waypoints.length;
  let a = i;
  for (let cum = 0, c = 0; a > 0 && cum < maxM && c < maxPts; a--, c++) cum += segLen(base, a - 1);
  let b = i;
  for (let cum = 0, c = 0; b < n - 1 && cum < maxM && c < maxPts; b++, c++) cum += segLen(base, b);
  const up = i > 0 ? a : null;
  const down = i < n - 1 ? b : null;
  if ((up === null || up === i - 1) && (down === null || down === i + 1)) return null;
  return { up, down };
}

type XY = [number, number];
const toXY = (c: Position, lat0: number): XY => [c[0] * Math.cos((lat0 * Math.PI) / 180) * 111320, c[1] * 110540];
function distToSeg(q: XY, a: XY, b: XY) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
}
const nearestVertex = (c: Position, path: Position[]) => {
  let best = 0;
  let bd = Infinity;
  path.forEach((v, k) => {
    const d = haversine(c, v);
    if (d < bd) {
      bd = d;
      best = k;
    }
  });
  return best;
};

/** Computation result: "new" document (segments to recompute) and indices of its two new segments. */
export type WidenResult = { doc: EditorDoc; segs: number[]; oldSegs: [number, number] };

/**
 * Builds the "new" document from the routes computed upstream anchor → point (`up`) and point → downstream anchor
 * (`down`). `null` if the new line does not rejoin the old one within the caps (falls back to #1451) or does not leave it.
 */
export function buildWiden(p: PendingDeviation, plan: WidenPlan, up: Position[] | null, down: Position[] | null, tolM = CHOICE_TOL_M): WidenResult | null {
  const { base, i } = p;
  const wp = base.waypoints;
  const a = plan.up ?? i;
  const b = plan.down ?? i;
  if ((plan.up !== null && !up) || (plan.down !== null && !down)) return null;
  // Old line from anchor to anchor, and position (vertex index) of each waypoint in it.
  const old: Position[] = [];
  const at: number[] = [];
  for (let k = a; k <= b; k++) {
    at[k] = old.length ? old.length - 1 : 0;
    if (k < b) {
      const line = segmentLine(base, k);
      old.push(...(old.length ? line.slice(1) : line));
    }
  }
  if (old.length < 2) return null;
  at[b] = old.length - 1;
  const lat0 = old[0][1];
  const oldXY = old.map((c) => toXY(c, lat0));
  const near = (c: Position) => {
    const q = toXY(c, lat0);
    let d = Infinity;
    for (let k = 1; k < oldXY.length; k++) d = Math.min(d, distToSeg(q, oldXY[k - 1], oldXY[k]));
    return d <= tolM;
  };
  let lo = 0; // vertex of the old line where the new one leaves it
  let hi = old.length - 1; // vertex where it rejoins it
  if (up) {
    let d = -1;
    while (d + 1 < up.length && near(up[d + 1])) d++;
    if (d >= up.length - 1) return null; // the dragged point is on the old line: nothing to bypass
    if (d <= 0 && a > 0 && a < i - 1) return null; // did not rejoin the old line within the cap
    lo = nearestVertex(up[Math.max(d, 0)], old);
  }
  if (down) {
    let d = down.length;
    while (d - 1 >= 0 && near(down[d - 1])) d--;
    if (d <= 0) return null;
    if (d >= down.length - 1 && b < wp.length - 1 && b > i + 1) return null;
    hi = nearestVertex(down[Math.min(d, down.length - 1)], old);
  }
  if (up && down && lo >= hi) return null;
  let a2 = a;
  for (let k = a; k <= i - 1; k++) if (at[k] <= lo) a2 = k;
  let b2 = b;
  for (let k = b; k >= i + 1; k--) if (at[k] >= hi) b2 = k;
  if (plan.up === null) a2 = i;
  if (plan.down === null) b2 = i;
  const hasL = plan.up !== null;
  const hasR = plan.down !== null;
  const route = (): Segment => ({ mode: 'route', coords: null });
  const waypoints = [...wp.slice(0, hasL ? a2 + 1 : 0), p.p, ...wp.slice(hasR ? b2 : wp.length)];
  const segments = [...base.segments.slice(0, hasL ? a2 : 0), ...(hasL ? [route()] : []), ...(hasR ? [route()] : []), ...base.segments.slice(hasR ? b2 : base.segments.length)];
  const first = hasL ? a2 : 0;
  const segs = [...(hasL ? [first] : []), ...(hasR ? [hasL ? first + 1 : 0] : [])];
  const from = hasL ? a2 : i;
  const to = hasR ? b2 : i;
  return { doc: { waypoints, segments }, segs, oldSegs: [from, Math.max(from, to - (p.inserted ? 1 : 0))] };
}

export type ChoiceWhich = 'new' | 'old';
/** Active choice pair: both documents, the applied one, and their segments (to hide the BRouter alternatives). */
export type ChoicePair = {
  selected: ChoiceWhich;
  new: EditorDoc;
  old: EditorDoc;
  newSegs: number[];
  oldSegs: [number, number];
};

export type ChoiceOption = { which: ChoiceWhich; doc: EditorDoc; stats: LiveStats };
/** Both options with km, gain, loss and profile (computed on demand: the "new" lines come from routing). */
export const choiceOptions = (c: ChoicePair): ChoiceOption[] => [
  { which: 'new', doc: c.new, stats: liveStats(c.new) },
  { which: 'old', doc: c.old, stats: liveStats(c.old) },
];

/** No BRouter alternatives (#1527) for the portion covered by a choice pair. */
export function withoutChoiceAlts(sets: AltSet[], c: ChoicePair | null): AltSet[] {
  if (!c) return sets;
  return sets.filter((s) => (c.selected === 'new' ? !c.newSegs.includes(s.seg) : s.seg < c.oldSegs[0] || s.seg >= c.oldSegs[1]));
}

/** Segments (indices in the option's document) that differ: only those get a halo and a label. */
export const choiceSegs = (c: ChoicePair, which: ChoiceWhich): number[] =>
  which === 'new' ? c.newSegs : Array.from({ length: Math.max(0, c.oldSegs[1] - c.oldSegs[0]) }, (_, k) => c.oldSegs[0] + k);

/** Difference of each option from the other: km and gain (null if the elevation is unknown on one side). */
export function choiceDeltas(c: ChoicePair): Record<ChoiceWhich, { km: number; gainM: number | null }> {
  const [n, o] = choiceOptions(c);
  const gain = n.stats.gainM !== null && o.stats.gainM !== null ? n.stats.gainM - o.stats.gainM : null;
  const km = (n.stats.distanceM - o.stats.distanceM) / 1000;
  return { new: { km, gainM: gain }, old: { km: -km, gainM: gain === null ? null : -gain } };
}
