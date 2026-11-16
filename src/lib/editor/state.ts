import type { Position } from '@/lib/geo';
import {
  addWaypoint, closeLoop, deviateWaypoint, insertWaypoint, restoreDeviation, type Deviation, moveWaypoint, prependHome, removeWaypoint, resolveSegment, reverseDoc,
  setAllModes, snapWaypoint, setSegmentMode, trimAfter, trimBefore, type EditorDoc, type LonLat, type SegmentMode,
} from './doc';

/** Historique annuler / rétablir : seuls les gestes de l'utilisateur sont empilés, pas les tracés calculés. */
export type EditorState = {
  past: EditorDoc[];
  present: EditorDoc;
  future: EditorDoc[];
  /** Mode appliqué aux nouveaux segments. */
  newMode: SegmentMode;
  selected: number | null;
  /** Parcours d'origine de la dernière déviation (#1451), proposé en alternative jusqu'au geste suivant. */
  deviation: Deviation | null;
};

export const HISTORY_LIMIT = 100;

export const initialState = (doc: EditorDoc, newMode: SegmentMode = 'route'): EditorState => ({
  past: [], present: doc, future: [], newMode, selected: null, deviation: null,
});

export type EditorAction =
  | { type: 'add'; p: LonLat }
  | { type: 'insert'; seg: number; p: LonLat }
  | { type: 'move'; i: number; p: LonLat }
  /** Glisser un point (ou la ligne, `seg` donné) = déviation (#1451) : retire les points d'origine voisins. */
  | { type: 'deviate'; i: number; p: LonLat; seg?: number }
  | { type: 'restoreDeviation' }
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
  // Résultats du routage : modifient le document courant sans entrer dans l'historique.
  | { type: 'resolved'; seg: number; from: LonLat; to: LonLat; coords: Position[] }
  /** Choix d'un itinéraire alternatif (#1386) : contrairement à `resolved`, c'est un geste, donc dans l'historique. */
  | { type: 'chooseRoute'; seg: number; from: LonLat; to: LonLat; coords: Position[] }
  /** Aimant BRouter (#1437) : le waypoint se cale sur le début/la fin du tracé calculé, sans historique. */
  | { type: 'snapEnd'; i: number; from: LonLat; p: LonLat }
  | { type: 'routeFailed'; seg: number; from: LonLat; to: LonLat };

function commit(s: EditorState, next: EditorDoc, selected: number | null = null): EditorState {
  if (next === s.present) return s;
  return { ...s, past: [...s.past, s.present].slice(-HISTORY_LIMIT), present: next, future: [], selected, deviation: null };
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
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
      const next = commit(s, r.doc, null); // glisser ne sélectionne pas (#1465)
      return { ...next, deviation: next === s ? s.deviation : r.deviation };
    }
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
      const prev = s.past.at(-1);
      return prev ? { ...s, past: s.past.slice(0, -1), present: prev, future: [d, ...s.future], selected: null, deviation: null } : s;
    }
    case 'redo': {
      const [next, ...rest] = s.future;
      return next ? { ...s, past: [...s.past, d], present: next, future: rest, selected: null, deviation: null } : s;
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
      // Seulement si le point n'a pas bougé depuis le calcul.
      const w = d.waypoints[a.i];
      return w && w[0] === a.from[0] && w[1] === a.from[1] ? { ...s, present: snapWaypoint(d, a.i, a.p) } : s;
    }
    case 'routeFailed': {
      // Pas de chemin entre ces deux points : on bascule ce segment en ligne droite.
      const same = d.waypoints[a.seg]?.join() === a.from.join() && d.waypoints[a.seg + 1]?.join() === a.to.join();
      return same ? { ...s, present: setSegmentMode(d, a.seg, 'line') } : s;
    }
  }
}
