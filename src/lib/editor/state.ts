import type { Position } from '@/lib/geo';
import {
  addWaypoint, closeLoop, deviateWaypoint, insertWaypoint, restoreDeviation, type Deviation, moveWaypoint, prependHome, removeWaypoint, resolveSegment, reverseDoc,
  setAllModes, snapWaypoint, setSegmentMode, trimAfter, trimBefore, type EditorDoc, type LonLat, type SegmentMode,
} from './doc';
import type { ChoicePair, ChoiceWhich, PendingDeviation, WidenResult } from './choice';

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
  /** Dernier glisser, en attente d'être élargi aux points posés à la main (#1641). */
  pending: PendingDeviation | null;
  /** Paire « nouveau / ancien chemin » (#1641) : `present` est l'option sélectionnée, l'historique n'a pas encore d'entrée. */
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
  /** Glisser un point (ou la ligne, `seg` donné) = déviation (#1451) : retire les points d'origine voisins. */
  | { type: 'deviate'; i: number; p: LonLat; seg?: number }
  | { type: 'restoreDeviation' }
  /** Résultat du calcul élargi (`buildWiden`) : ouvre la paire de choix, sans entrée d'historique. */
  | { type: 'widen'; result: WidenResult }
  /** Aperçu d'une option : ne touche pas à l'historique. */
  | { type: 'selectChoice'; which: ChoiceWhich }
  /** Valide l'option sélectionnée : une seule entrée d'historique (annuler = avant le glisser). */
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
  // Résultats du routage : modifient le document courant sans entrer dans l'historique.
  | { type: 'resolved'; seg: number; from: LonLat; to: LonLat; coords: Position[] }
  /** Choix d'un itinéraire alternatif (#1386) : contrairement à `resolved`, c'est un geste, donc dans l'historique. */
  | { type: 'chooseRoute'; seg: number; from: LonLat; to: LonLat; coords: Position[] }
  /** Aimant BRouter (#1437) : le waypoint se cale sur le début/la fin du tracé calculé, sans historique. */
  | { type: 'snapEnd'; i: number; from: LonLat; p: LonLat }
  | { type: 'routeFailed'; seg: number; from: LonLat; to: LonLat };

/** Valide la paire de choix active : l'état d'avant le glisser entre dans l'historique, l'option sélectionnée devient définitive. */
function settleChoice(s: EditorState): EditorState {
  const c = s.choice;
  if (!c) return s;
  return { ...s, past: [...s.past, c.old].slice(-HISTORY_LIMIT), present: c.selected === 'new' ? c.new : c.old, future: [], choice: null, pending: null };
}

function commit(s: EditorState, next: EditorDoc, selected: number | null = null): EditorState {
  const b = settleChoice(s); // un nouveau geste valide implicitement l'option sélectionnée
  if (next === b.present) return s;
  return { ...b, past: [...b.past, b.present].slice(-HISTORY_LIMIT), present: next, future: [], selected, deviation: null, pending: null };
}

/** Les résultats de routage mettent aussi à jour le document de la paire de choix qui correspond à l'option appliquée. */
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
      const next = commit(s, r.doc, null); // glisser ne sélectionne pas (#1465)
      if (next === s) return s;
      return { ...next, deviation: r.deviation, pending: { before: d, base, i, p: a.p, inserted: base !== d } };
    }
    case 'widen': {
      // Valable seulement juste après le glisser (l'entrée d'historique du glisser est reprise par la paire de choix).
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
      // Paire de choix active : annuler = retour exact à l'avant-glisser (l'historique n'a pas encore d'entrée).
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
