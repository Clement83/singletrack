import type { Position } from '@/lib/geo';
import {
  addWaypoint, closeLoop, deviateWaypoint, insertWaypoint, restoreDeviation, type Deviation, moveWaypoint, prependHome, removeWaypoint, resolveSegment, reverseDoc,
  setAllModes, snapWaypoint, setSegmentMode, trimAfter, trimBefore, type EditorDoc, type LonLat, type SegmentMode,
} from './doc';
import type { ChoicePair, ChoiceWhich, PendingDeviation, WidenResult } from './choice';

/** Undo / redo history: only user gestures are stacked, not computed lines. */
export type EditorState = {
  past: EditorDoc[];
  present: EditorDoc;
  future: EditorDoc[];
  /** Mode applied to new segments. */
  newMode: SegmentMode;
  selected: number | null;
  /** Original route of the last detour (#1451), offered as an alternative until the next gesture. */
  deviation: Deviation | null;
  /** Last drag, waiting to be widened to hand-placed points (#1641). */
  pending: PendingDeviation | null;
  /** "New / old path" pair (#1641): `present` is the selected option, the history has no entry yet. */
  choice: ChoicePair | null;
};

export const HISTORY_LIMIT = 100;

export const initialState = (doc: EditorDoc, newMode: SegmentMode = 'route'): EditorState => ({
  past: [], present: doc, future: [], newMode, selected: null, deviation: null, pending: null, choice: null,
});

export type EditorAction =
  | { type: 'add'; p: LonLat }
  | { type: 'insert'; seg: number; p: LonLat }
  | { type: 'move'; i: number; p: LonLat }
  /** Dragging a point (or the line, `seg` given) = detour (#1451): removes the neighbouring original points. */
  | { type: 'deviate'; i: number; p: LonLat; seg?: number }
  | { type: 'restoreDeviation' }
  /** Result of the widened computation (`buildWiden`): opens the choice pair, without a history entry. */
  | { type: 'widen'; result: WidenResult }
  /** Preview of an option: does not touch the history. */
  | { type: 'selectChoice'; which: ChoiceWhich }
  /** Validates the selected option: a single history entry (undo = before the drag). */
  | { type: 'commitChoice' }
  | { type: 'remove'; i: number }
  | { type: 'segmentMode'; seg: number; mode: SegmentMode }
  | { type: 'allModes'; mode: SegmentMode }
  | { type: 'reverse' }
  | { type: 'close' }
  | { type: 'home'; home: LonLat }
  | { type: 'trimBefore'; i: number }
  | { type: 'trimAfter'; i: number }
  | { type: 'newMode'; mode: SegmentMode }
  | { type: 'select'; i: number | null }
  | { type: 'undo' }
  | { type: 'redo' }
  // Routing results: change the current document without entering the history.
  | { type: 'resolved'; seg: number; from: LonLat; to: LonLat; coords: Position[] }
  /** Choice of an alternative route (#1386): unlike `resolved`, it is a gesture, so it goes in the history. */
  | { type: 'chooseRoute'; seg: number; from: LonLat; to: LonLat; coords: Position[] }
  /** BRouter magnet (#1437): the waypoint snaps onto the start/end of the computed line, without history. */
  | { type: 'snapEnd'; i: number; from: LonLat; p: LonLat }
  | { type: 'routeFailed'; seg: number; from: LonLat; to: LonLat };

/** Validates the active choice pair: the pre-drag state enters the history, the selected option becomes final. */
function settleChoice(s: EditorState): EditorState {
  const c = s.choice;
  if (!c) return s;
  return { ...s, past: [...s.past, c.old].slice(-HISTORY_LIMIT), present: c.selected === 'new' ? c.new : c.old, future: [], choice: null, pending: null };
}

function commit(s: EditorState, next: EditorDoc, selected: number | null = null): EditorState {
  const b = settleChoice(s); // a new gesture implicitly validates the selected option
  if (next === b.present) return s;
  return { ...b, past: [...b.past, b.present].slice(-HISTORY_LIMIT), present: next, future: [], selected, deviation: null, pending: null };
}

/** Routing results also update the choice pair's document that matches the applied option. */
export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  const r = reduce(s, a);
  const c = r.choice;
  if (c && r.present !== s.present && (a.type === 'resolved' || a.type === 'snapEnd' || a.type === 'routeFailed')) {
    return { ...r, choice: c.selected === 'new' ? { ...c, new: r.present } : { ...c, old: r.present } };
  }
  return r;
}

function reduce(s: EditorState, a: EditorAction): EditorState {
  const d = s.present;
  switch (a.type) {
    case 'add':
      return commit(s, addWaypoint(d, a.p, s.newMode));
    case 'insert':
      return commit(s, insertWaypoint(d, a.seg, a.p));
    case 'move':
      return commit(s, moveWaypoint(d, a.i, a.p), s.selected === a.i ? a.i : null);
    case 'deviate': {
      const base = a.seg === undefined ? d : insertWaypoint(d, a.seg, a.p);
      const i = a.seg === undefined ? a.i : a.seg + 1;
      const r = deviateWaypoint(base, i, a.p);
      const next = commit(s, r.doc, null); // dragging does not select (#1465)
      if (next === s) return s;
      return { ...next, deviation: r.deviation, pending: { before: d, base, i, p: a.p, inserted: base !== d } };
    }
    case 'widen': {
      // Only valid right after the drag (the drag's history entry is taken over by the choice pair).
      const pd = s.pending;
      if (!pd || s.choice || s.past.at(-1) !== pd.before) return s;
      return {
        ...s, past: s.past.slice(0, -1), present: a.result.doc, deviation: null, pending: null, selected: null,
        choice: { selected: 'new', new: a.result.doc, old: pd.before, newSegs: a.result.segs, oldSegs: a.result.oldSegs },
      };
    }
    case 'selectChoice': {
      const c = s.choice;
      if (!c || c.selected === a.which) return s;
      return { ...s, present: a.which === 'new' ? c.new : c.old, choice: { ...c, selected: a.which }, selected: null };
    }
    case 'commitChoice':
      return settleChoice(s);
    case 'restoreDeviation': {
      if (!s.deviation) return s;
      return commit(s, restoreDeviation(d, s.deviation));
    }
    case 'remove':
      return commit(s, removeWaypoint(d, a.i));
    case 'segmentMode':
      return commit(s, setSegmentMode(d, a.seg, a.mode), s.selected);
    case 'allModes':
      return commit({ ...s, newMode: a.mode }, setAllModes(d, a.mode));
    case 'reverse':
      return commit(s, reverseDoc(d));
    case 'close':
      return commit(s, closeLoop(d, s.newMode));
    case 'home':
      return commit(s, prependHome(d, a.home, s.newMode));
    case 'trimBefore':
      return commit(s, trimBefore(d, a.i));
    case 'trimAfter':
      return commit(s, trimAfter(d, a.i));
    case 'newMode':
      return { ...s, newMode: a.mode };
    case 'select':
      return { ...s, selected: a.i };
    case 'undo': {
      // Active choice pair: undo = exact return to before the drag (the history has no entry yet).
      if (s.choice) return { ...s, present: s.choice.old, choice: null, pending: null, selected: null, deviation: null };
      const prev = s.past.at(-1);
      return prev ? { ...s, past: s.past.slice(0, -1), present: prev, future: [d, ...s.future], selected: null, deviation: null, pending: null } : s;
    }
    case 'redo': {
      const [next, ...rest] = s.future;
      return next ? { ...s, past: [...s.past, d], present: next, future: rest, selected: null, deviation: null, pending: null } : s;
    }
    case 'resolved': {
      const next = resolveSegment(d, a.seg, a.from, a.to, a.coords);
      return next === d ? s : { ...s, present: next };
    }
    case 'chooseRoute': {
      const next = resolveSegment(d, a.seg, a.from, a.to, a.coords);
      return next === d ? s : { ...commit(s, next, s.selected), deviation: s.deviation };
    }
    case 'snapEnd': {
      // Only if the point has not moved since the computation.
      const w = d.waypoints[a.i];
      return w && w[0] === a.from[0] && w[1] === a.from[1] ? { ...s, present: snapWaypoint(d, a.i, a.p) } : s;
    }
    case 'routeFailed': {
      // No path between these two points: the segment becomes a placeholder flagged `failed` (#1686), not a silent straight line.
      const same = d.waypoints[a.seg]?.join() === a.from.join() && d.waypoints[a.seg + 1]?.join() === a.to.join();
      if (!same) return s;
      return { ...s, present: { ...d, segments: d.segments.map((x, k) => (k === a.seg ? { mode: 'line' as const, coords: null, failed: true as const } : x)) } };
    }
  }
}
