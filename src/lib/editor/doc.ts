import { haversine, type LineString, type Position, type TrackGeometry } from '@/lib/geo';
import { simplifyLine } from '@/lib/geo/simplify';

/**
 * Model of the track editor (#1340): waypoints joined two by two by segments.
 * Each segment follows the paths (BRouter) or goes in a straight line; its `coords` are the computed line
 * (`null` = to compute). Pure functions, no React: everything is testable.
 */
export type LonLat = [number, number];
export type SegmentMode = 'route' | 'line';
/** `failed`: BRouter found no path (#1686); the segment is a placeholder straight line, flagged "not computed". */
export type Segment = { mode: SegmentMode; coords: Position[] | null; failed?: true };
export type EditorDoc = { waypoints: LonLat[]; segments: Segment[] };

export const emptyDoc = (): EditorDoc => ({ waypoints: [], segments: [] });

const same = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];
const frozen = (s: Segment | undefined) => !!s && s.mode === 'line' && !!s.coords;
const seg = (mode: SegmentMode, coords: Position[] | null = null): Segment => ({ mode, coords });

export function addWaypoint(doc: EditorDoc, p: LonLat, mode: SegmentMode): EditorDoc {
  return {
    waypoints: [...doc.waypoints, p],
    segments: doc.waypoints.length ? [...doc.segments, seg(mode)] : doc.segments,
  };
}

/** Inserts a point on segment `i` (click on the line). The already computed line is cut, not recomputed. */
export function insertWaypoint(doc: EditorDoc, i: number, p: LonLat): EditorDoc {
  const s = doc.segments[i];
  if (!s) return doc;
  let at: LonLat = p;
  let left = seg(s.mode);
  let right = seg(s.mode);
  const c = s.coords;
  if (c && c.length > 2) {
    // Attaches the point to the closest vertex (inside the line): the existing geometry is kept.
    let k = 1;
    let best = Infinity;
    for (let j = 1; j < c.length - 1; j++) {
      const d = haversine(c[j], p);
      if (d < best) {
        best = d;
        k = j;
      }
    }
    at = [c[k][0], c[k][1]];
    left = seg(s.mode, c.slice(0, k + 1));
    right = seg(s.mode, c.slice(k));
  }
  const waypoints = [...doc.waypoints];
  waypoints.splice(i + 1, 0, at);
  const segments = [...doc.segments];
  segments.splice(i, 1, left, right);
  return { waypoints, segments };
}

/** Moves a point: the two neighbouring segments have to be recomputed. */
export function moveWaypoint(doc: EditorDoc, i: number, p: LonLat): EditorDoc {
  if (!doc.waypoints[i]) return doc;
  const waypoints = doc.waypoints.map((w, k) => (k === i ? p : w));
  // A frozen segment (line carrying its original route) must be recomputed by BRouter, not become a straight line (#1686);
  // a deliberate straight line (no original route) stays one.
  const segments = doc.segments.map((s, k) => (k === i - 1 || k === i ? seg(frozen(s) ? 'route' : s.mode) : s));
  return { waypoints, segments };
}

/** Brings a waypoint back onto the computed line (BRouter magnet, #1437) without invalidating the neighbouring segments. */
export function snapWaypoint(doc: EditorDoc, i: number, p: LonLat): EditorDoc {
  if (!doc.waypoints[i]) return doc;
  return { ...doc, waypoints: doc.waypoints.map((w, k) => (k === i ? p : w)) };
}

export function removeWaypoint(doc: EditorDoc, i: number): EditorDoc {
  if (!doc.waypoints[i]) return doc;
  const waypoints = doc.waypoints.filter((_, k) => k !== i);
  if (waypoints.length === 0) return emptyDoc();
  const segments = [...doc.segments];
  if (i === 0) segments.splice(0, 1);
  else if (i === doc.waypoints.length - 1) segments.splice(i - 1, 1);
  else segments.splice(i - 1, 2, seg(doc.segments[i - 1].mode)); // the two neighbours merge
  return { waypoints, segments };
}

export function setSegmentMode(doc: EditorDoc, i: number, mode: SegmentMode): EditorDoc {
  const s = doc.segments[i];
  if (!s || s.mode === mode) return doc;
  return { ...doc, segments: doc.segments.map((x, k) => (k === i ? seg(mode) : x)) };
}

/** "Snap": every segment switches to the same mode (e.g. everything follows the paths). */
export function setAllModes(doc: EditorDoc, mode: SegmentMode): EditorDoc {
  return { ...doc, segments: doc.segments.map((s) => (s.mode === mode ? s : seg(mode))) };
}

export function reverseDoc(doc: EditorDoc): EditorDoc {
  return {
    waypoints: [...doc.waypoints].reverse(),
    segments: [...doc.segments].reverse().map((s) => ({ mode: s.mode, coords: s.coords ? [...s.coords].reverse() : null })),
  };
}

/** Back to the start point. No effect if the track is empty, or already closed. */
export function closeLoop(doc: EditorDoc, mode: SegmentMode): EditorDoc {
  const n = doc.waypoints.length;
  if (n < 2 || same(doc.waypoints[0], doc.waypoints[n - 1])) return doc;
  return addWaypoint(doc, doc.waypoints[0], mode);
}

/** Home → start link: home becomes the first point. */
export function prependHome(doc: EditorDoc, home: LonLat, mode: SegmentMode): EditorDoc {
  if (doc.waypoints.length && same(doc.waypoints[0], home)) return doc;
  return {
    waypoints: [home, ...doc.waypoints],
    segments: doc.waypoints.length ? [seg(mode), ...doc.segments] : doc.segments,
  };
}

/** Cuts the beginning: point `i` becomes the start. */
export function trimBefore(doc: EditorDoc, i: number): EditorDoc {
  if (i <= 0 || i >= doc.waypoints.length) return doc;
  return { waypoints: doc.waypoints.slice(i), segments: doc.segments.slice(i) };
}

/** Cuts the end: point `i` becomes the finish. */
export function trimAfter(doc: EditorDoc, i: number): EditorDoc {
  if (i < 0 || i >= doc.waypoints.length - 1) return doc;
  return { waypoints: doc.waypoints.slice(0, i + 1), segments: doc.segments.slice(0, i) };
}

/** Stores the computed line of a segment, if its end points did not move in the meantime. */
export function resolveSegment(doc: EditorDoc, i: number, from: LonLat, to: LonLat, coords: Position[]): EditorDoc {
  const a = doc.waypoints[i];
  const b = doc.waypoints[i + 1];
  const s = doc.segments[i];
  if (!a || !b || !s || s.mode !== 'route' || !same(a, from) || !same(b, to)) return doc;
  return { ...doc, segments: doc.segments.map((x, k) => (k === i ? { mode: 'route', coords } : x)) };
}

/** "Follow the paths" segments whose line still has to be asked from BRouter. */
export function pendingSegments(doc: EditorDoc): number[] {
  return doc.segments.flatMap((s, i) => (s.mode === 'route' && !s.coords ? [i] : []));
}

/** Intermediate points every `stepM` m on a straight line (so that the IGN elevation follows the terrain). */
export function densify(a: Position, b: Position, stepM: number): Position[] {
  const n = Math.max(1, Math.ceil(haversine(a, b) / stepM));
  return Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n] as Position);
}

export type DocGeometryOptions = {
  /** Densifies straight lines (saving); otherwise two points are enough (display). */
  densifyM?: number;
};

/** Line of each segment (a segment still to compute is shown as a temporary straight line). */
export function segmentLine(doc: EditorDoc, i: number, opts: DocGeometryOptions = {}): Position[] {
  const s = doc.segments[i];
  if (s.coords) return s.coords;
  const a = doc.waypoints[i];
  const b = doc.waypoints[i + 1];
  return opts.densifyM ? densify(a, b, opts.densifyM) : [a, b];
}

/** Full geometry, or `null` with fewer than two points. Junctions are not duplicated. */
export function docGeometry(doc: EditorDoc, opts: DocGeometryOptions = {}): LineString | null {
  if (doc.waypoints.length < 2) return null;
  const out: Position[] = [];
  doc.segments.forEach((_, i) => {
    const line = segmentLine(doc, i, opts);
    out.push(...(i === 0 ? line : line.slice(1)));
  });
  return { type: 'LineString', coordinates: out };
}

/** `frozen[i]`: segment `i` is a line carrying its original route (import/copy), not a deliberate straight line (#1686). Optional: older documents lack it. */
export type StoredDoc = { waypoints: LonLat[]; modes: SegmentMode[]; frozen?: boolean[] };

export const docToStored = (doc: EditorDoc): StoredDoc => ({
  waypoints: doc.waypoints,
  modes: doc.segments.map((s) => s.mode),
  frozen: doc.segments.map((s) => frozen(s)),
});

/** Reads a saved document back: "paths" segments have to be recomputed. */
export function docFromStored(s: StoredDoc): EditorDoc {
  return { waypoints: s.waypoints, segments: s.modes.map((m) => seg(m)) };
}

/** Legacy heuristic: a line whose vertices all lie within 3 m of the chord is a deliberate straight line. */
function isStraight(c: Position[]): boolean {
  const a = c[0];
  const b = c[c.length - 1];
  const len = haversine(a, b);
  if (len === 0) return false;
  return c.every((p) => haversine(a, p) + haversine(p, b) - len < 3);
}

/**
 * Reads a saved document back **reusing the saved line** (#1526): the track geometry is cut at the
 * waypoints (first vertex within `tolM` going forward), so each "paths" segment gets its line back and only
 * the modified portion will be recomputed. A waypoint that cannot be found leaves its neighbouring segments to recompute.
 */
export function docFromStoredWithGeometry(s: StoredDoc, g: TrackGeometry, tolM = 2): EditorDoc {
  const doc = docFromStored(s);
  const all: Position[] = g.type === 'LineString' ? g.coordinates : g.coordinates.flat();
  if (all.length < 2 || s.waypoints.length < 2) return doc;
  const at: (number | null)[] = [];
  let from = 0;
  for (const w of s.waypoints) {
    let found: number | null = null;
    for (let j = from; j < all.length; j++) {
      if (haversine(all[j], w) <= tolM) {
        found = j;
        break;
      }
    }
    at.push(found);
    if (found !== null) from = found;
  }
  doc.segments.forEach((sg, k) => {
    const a = at[k];
    const b = at[k + 1];
    if (a == null || b == null || b <= a) return;
    const slice = all.slice(a, b + 1);
    if (sg.mode === 'route') sg.coords = slice;
    else if (s.frozen ? s.frozen[k] : !isStraight(slice)) sg.coords = slice; // legacy documents: a bent line was frozen
  });
  return doc;
}

/** Validates the shape of a document read from the database (`raw` column) or received from a client. */
export function parseStored(v: unknown, maxPoints = 500): StoredDoc | null {
  if (!v || typeof v !== 'object') return null;
  const { waypoints, modes } = v as Record<string, unknown>;
  if (!Array.isArray(waypoints) || !Array.isArray(modes) || waypoints.length > maxPoints) return null;
  if (!waypoints.every((w) => Array.isArray(w) && w.length >= 2 && Number.isFinite(w[0]) && Number.isFinite(w[1]))) return null;
  if (modes.length !== Math.max(0, waypoints.length - 1) || !modes.every((m) => m === 'route' || m === 'line')) return null;
  const out: StoredDoc = { waypoints: waypoints.map((w) => [w[0], w[1]] as LonLat), modes: modes as SegmentMode[] };
  const fz = (v as Record<string, unknown>).frozen;
  if (Array.isArray(fz) && fz.length === modes.length && fz.every((f) => typeof f === 'boolean')) out.frozen = fz as boolean[];
  return out;
}

/**
 * Opens an existing geometry (GPX import, OSM track...): ≤ `maxPoints` vertices are kept as
 * waypoints, and each segment keeps the original line (line mode) — nothing moves until a point is
 * moved or a segment is switched to "follow the paths".
 */
export function docFromGeometry(g: TrackGeometry, maxPoints = 60): EditorDoc {
  const all: Position[] = g.type === 'LineString' ? g.coordinates : g.coordinates.flat();
  if (all.length < 2) return emptyDoc();
  let idx: number[] = [];
  for (let tol = 5; tol < 5000; tol *= 1.6) {
    // Douglas-Peucker on indices: the kept vertices are found back through their coordinates.
    const kept = simplifyLine(all.map((p, i) => [p[0], p[1], i] as Position), tol);
    idx = kept.map((p) => p[2] as number);
    if (idx.length <= maxPoints) break;
  }
  if (idx[0] !== 0) idx.unshift(0);
  if (idx[idx.length - 1] !== all.length - 1) idx.push(all.length - 1);
  idx = idx.filter((v, k) => k === 0 || v > idx[k - 1]);
  return {
    waypoints: idx.map((i) => [all[i][0], all[i][1]] as LonLat),
    segments: idx.slice(1).map((end, k) => seg('line', all.slice(idx[k], end + 1))),
  };
}

/** Detour window (#1451): length of original line "freed" on each side of the dragged point. */
export const DEVIATION_WINDOW_M = 400;

/** Original route replaced by a detour, offered as an alternative: `a` = index of the first anchor. */
export type Deviation = {
  a: number;
  /** Number of waypoints of the detoured document and of those replacing the original (restore safeguard). */
  len: number;
  count: number;
  waypoints: LonLat[];
  segments: Segment[];
  /** Original line from anchor to anchor (clickable grey line). */
  path: Position[];
};

const lineLen = (c: Position[]) => c.reduce((s, p, k) => (k ? s + haversine(c[k - 1], p) : 0), 0);
/** An "original" segment: frozen line carrying its route (import / copy), which the window may absorb. */
const absorbable = (s: Segment | undefined) => !!s && s.mode === 'line' && !!s.coords;

/**
 * Drags waypoint `i` to `p` as a **detour**: the original waypoints (frozen segments) over ~`windowM` of line
 * on each side are removed; anchor → point → anchor are to be recomputed by BRouter. If the anchors are the direct
 * neighbours (hand-drawn track, few points), it is the usual move and `deviation` is `null`.
 * The window stops at the first segment that is not an original line, and ends on the waypoint that goes past it.
 */
export function deviateWaypoint(
  doc: EditorDoc, i: number, p: LonLat, windowM = DEVIATION_WINDOW_M,
): { doc: EditorDoc; deviation: Deviation | null } {
  const n = doc.waypoints.length;
  if (!doc.waypoints[i]) return { doc, deviation: null };
  let a = i;
  for (let cum = 0; a > 0 && absorbable(doc.segments[a - 1]) && cum < windowM; a--) cum += lineLen(doc.segments[a - 1].coords!);
  let b = i;
  for (let cum = 0; b < n - 1 && absorbable(doc.segments[b]) && cum < windowM; b++) cum += lineLen(doc.segments[b].coords!);
  const hasL = i > 0;
  const hasR = i < n - 1;
  const la = hasL ? Math.min(a, i - 1) : i;
  const rb = hasR ? Math.max(b, i + 1) : i;
  if ((!hasL || la === i - 1) && (!hasR || rb === i + 1)) return { doc: moveWaypoint(doc, i, p), deviation: null };
  const start = hasL ? la : i;
  const waypoints = [...doc.waypoints.slice(0, hasL ? la + 1 : 0), p, ...doc.waypoints.slice(hasR ? rb : n)];
  const segments = [
    ...doc.segments.slice(0, la),
    ...(hasL ? [seg(la === i - 1 && !frozen(doc.segments[i - 1]) ? doc.segments[i - 1].mode : 'route')] : []),
    ...(hasR ? [seg(rb === i + 1 && !frozen(doc.segments[i]) ? doc.segments[i].mode : 'route')] : []),
    ...doc.segments.slice(rb),
  ];
  const origSegs = doc.segments.slice(start, hasR ? rb : i);
  const path: Position[] = [];
  origSegs.forEach((_, k) => {
    const line = segmentLine(doc, start + k);
    path.push(...(k === 0 ? line : line.slice(1)));
  });
  return {
    doc: { waypoints, segments },
    deviation: {
      a: start, len: waypoints.length, count: (hasL ? 1 : 0) + 1 + (hasR ? 1 : 0),
      waypoints: doc.waypoints.slice(start, (hasR ? rb : i) + 1), segments: origSegs, path,
    },
  };
}

/** Restores the original route of a detour, or returns the document as is if it changed shape. */
export function restoreDeviation(doc: EditorDoc, d: Deviation): EditorDoc {
  if (doc.waypoints.length !== d.len) return doc;
  return {
    waypoints: [...doc.waypoints.slice(0, d.a), ...d.waypoints, ...doc.waypoints.slice(d.a + d.count)],
    segments: [...doc.segments.slice(0, d.a), ...d.segments, ...doc.segments.slice(d.a + d.count - 1)],
  };
}
