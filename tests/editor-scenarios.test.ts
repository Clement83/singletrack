import type { Position } from '@/lib/geo';
import { describe, it, expect } from 'vitest';
import { docFromGeometry, docGeometry, type LonLat } from '@/lib/editor/doc';
import { decideClick, moveLineDrag, endLineDrag, resolveRouted, chooseAltResult, TAP_AFTER_DRAG_MS, DRAG_THRESHOLD_PX } from '@/lib/editor/gestures';
import { nextAlt } from '@/lib/editor/alts';
import { EditorSim, FIXTURES, fx, shiftPx, project } from './helpers/editor-sim';

/** Scénarios de l'éditeur (#1522) : gestes → waypoints, tronçons, alternatives, avec les vraies réponses BRouter enregistrées. */
// Tutu (copie) : fixtures 0..5 chaînées. Points posés exactement sur une route : fixtures 12..14 (sommets du tronçon 0).
const W: LonLat[] = [fx(0).from, fx(0).to, fx(1).to, fx(2).to, fx(3).to, fx(4).to, fx(5).to];
const sameCoords = (a: unknown, b: unknown) => expect(a).toEqual(b);

const traced = (n: number) => {
  const s = new EditorSim();
  W.slice(0, n).forEach((p) => s.add(p));
  s.settle();
  return s;
};

describe('scénarios éditeur : poser des points', () => {
  it('tracé simple : deux points → un tronçon routé identique à BRouter', () => {
    const s = traced(2);
    expect(s.waypoints).toEqual([W[0], W[1]]);
    expect(s.segments).toHaveLength(1);
    sameCoords(s.segments[0].coords, fx(0).coordinates);
  });
  it('trois points : les jonctions ne sont pas dupliquées dans la géométrie', () => {
    const s = traced(3);
    expect(s.geometry!.coordinates).toHaveLength(fx(0).coordinates.length + fx(1).coordinates.length - 1);
  });
  it('un tronçon n’est demandé qu’une fois par couple de points', () => {
    const s = traced(4);
    expect(s.calls).toHaveLength(3);
    s.settle();
    expect(s.calls).toHaveLength(3);
  });
  it('boucle : le retour au départ est un tronçon routé de plus', () => {
    const s = traced(3);
    s.dispatch({ type: 'close' });
    expect(s.waypoints).toHaveLength(4);
    expect(s.waypoints[3]).toEqual(W[0]);
    s.settle();
    expect(s.segments.every((x) => x.coords)).toBe(true);
    expect(s.geometry!.coordinates.at(-1)!.slice(0, 2)).toEqual(s.geometry!.coordinates[0].slice(0, 2));
  });
  it('mode ligne : aucun routage demandé', () => {
    const s = new EditorSim({ newMode: 'line' });
    s.add(W[0]);
    s.add(W[1]);
    s.settle();
    expect(s.calls).toHaveLength(0);
    expect(s.segments[0].coords).toBeNull();
  });
  it('pas de chemin : le tronçon bascule en ligne droite', () => {
    const s = new EditorSim();
    s.failFor.add(`${W[0]}|${W[1]}`);
    s.add(W[0]);
    s.add(W[1]);
    s.settle();
    expect(s.segments[0].mode).toBe('line');
  });
  it('tap sur la carte avec un point sélectionné : désélectionne sans rien ajouter', () => {
    const s = traced(2);
    s.dispatch({ type: 'select', i: 1 });
    s.add(W[3]);
    expect(s.state.selected).toBeNull();
    expect(s.waypoints).toHaveLength(2);
  });
});

describe('scénarios éditeur : insérer et glisser', () => {
  it('tap sur la ligne : point inséré sur un sommet du tracé, sans nouveau routage', () => {
    const s = traced(3);
    const calls = s.calls.length;
    const c = fx(0).coordinates;
    s.tapLine(0, [c[10][0], c[10][1]]);
    expect(s.waypoints).toHaveLength(4);
    expect(s.waypoints[1]).toEqual([c[10][0], c[10][1]]);
    expect(s.segments[0].coords!.length + s.segments[1].coords!.length).toBe(c.length + 1);
    s.settle();
    expect(s.calls).toHaveLength(calls);
  });
  it('glisser un point : ses deux tronçons sont recalculés, les autres gardent leur tracé', () => {
    const s = traced(4);
    const keep = s.segments[2].coords;
    const target: LonLat = [W[1][0] + 0.001, W[1][1] + 0.001];
    s.dragPoint(1, target);
    expect(s.waypoints[1]).toEqual(target);
    expect(s.segments[0].coords).toBeNull();
    expect(s.segments[1].coords).toBeNull();
    expect(s.segments[2].coords).toBe(keep);
    expect(s.state.deviation).toBeNull();
    s.settle();
    expect(s.segments[0].coords![0]).toEqual(W[0]);
  });
  it('glisser un point puis le ramener : le cache évite un second appel', () => {
    const s = traced(2);
    const n = s.calls.length;
    s.dragPoint(1, [W[1][0] + 0.002, W[1][1]]);
    s.settle();
    s.dragPoint(1, W[1]);
    s.settle();
    expect(s.calls).toHaveLength(n + 1);
    sameCoords(s.segments[0].coords, fx(0).coordinates);
  });
  it('glisser la ligne : insère un point à l’endroit relâché', () => {
    const s = traced(3);
    const c = fx(0).coordinates;
    const mid: LonLat = [c[15][0], c[15][1]];
    const to: LonLat = [mid[0] + 0.001, mid[1] - 0.001];
    s.dragLine(0, mid, to);
    expect(s.waypoints).toHaveLength(4);
    expect(s.waypoints[1]).toEqual(to);
    s.settle();
    expect(s.segments).toHaveLength(3);
    expect(s.segments.every((x) => x.coords)).toBe(true);
  });
  it('glisser la ligne sur moins de 4 px : simple clic, rien ne change', () => {
    const s = traced(3);
    const before = s.doc;
    const c = fx(0).coordinates;
    s.dragLine(0, [c[15][0], c[15][1]], [c[15][0], c[15][1]], false);
    expect(s.doc).toBe(before);
  });
  it('le relâchement d’un glisser n’est pas pris pour un tap', () => {
    const base = { features: [], p: W[0], selected: null, lineMenuOpen: false, snap: () => null };
    expect(decideClick({ ...base, sinceDragMs: TAP_AFTER_DRAG_MS - 1 }).kind).toBe('ignore');
    expect(decideClick({ ...base, sinceDragMs: TAP_AFTER_DRAG_MS }).kind).toBe('dispatch');
  });
  it('le menu de la ligne ouvert absorbe le tap', () => {
    expect(decideClick({ features: [], p: W[0], selected: null, lineMenuOpen: true, sinceDragMs: 9999, snap: () => null }).kind).toBe('closeMenu');
  });
  it('seuil de glisser', () => {
    const d = { seg: 0, x: 0, y: 0, p: W[0], moved: false };
    expect(moveLineDrag(d, { x: DRAG_THRESHOLD_PX, y: 0 }, W[1]).moved).toBe(false);
    expect(moveLineDrag(d, { x: DRAG_THRESHOLD_PX + 1, y: 0 }, W[1]).moved).toBe(true);
    expect(endLineDrag(d, W[1], () => null)).toBeNull();
  });
});

describe('scénarios éditeur : annuler / rétablir', () => {
  it('annuler le dernier point, puis rétablir : les tracés reviennent du cache, sans nouvel appel', () => {
    const s = traced(3);
    const calls = s.calls.length;
    s.undo();
    expect(s.waypoints).toHaveLength(2);
    s.settle();
    sameCoords(s.segments[0].coords, fx(0).coordinates);
    expect(s.calls).toHaveLength(calls);
    s.redo();
    expect(s.waypoints).toHaveLength(3);
    s.settle();
    sameCoords(s.segments[1].coords, fx(1).coordinates);
  });
  it('annuler un glisser : le point revient, tracé d’origine compris', () => {
    const s = traced(3);
    s.dragPoint(1, [W[1][0] + 0.002, W[1][1]]);
    s.settle();
    s.undo();
    expect(s.waypoints[1]).toEqual(W[1]);
    s.settle();
    sameCoords(s.segments[0].coords, fx(0).coordinates);
  });
  it('le routage n’entre pas dans l’historique', () => {
    const s = traced(2);
    expect(s.state.past).toHaveLength(2); // deux « add »
    s.undo();
    s.undo();
    expect(s.waypoints).toHaveLength(0);
  });
});

describe('scénarios éditeur : alternatives', () => {
  it('le tronçon recommandé est proposé avec ses alternatives', () => {
    const s = traced(2);
    expect(s.alts!.routes).toHaveLength(2);
    expect(s.alts!.active).toBe(0);
    sameCoords(s.alts!.routes[1], fx(0).alternatives[0].coordinates);
  });
  it('choisir une alternative, puis annuler : retour au recommandé ; rétablir : l’alternative', () => {
    const s = traced(2);
    s.chooseAlt(1);
    sameCoords(s.segments[0].coords, fx(0).alternatives[0].coordinates);
    expect(s.alts!.active).toBe(1);
    s.undo();
    sameCoords(s.segments[0].coords, fx(0).coordinates);
    s.redo();
    sameCoords(s.segments[0].coords, fx(0).alternatives[0].coordinates);
  });
  it('tap sur l’alternative grise = la choisir ; tap sur la même : sans effet', () => {
    const s = traced(2);
    s.tapAlt(1, W[0]);
    sameCoords(s.segments[0].coords, fx(0).alternatives[0].coordinates);
    const past = s.state.past.length;
    s.tapAlt(1, W[0]);
    expect(s.state.past).toHaveLength(past);
  });
  it('raccourci A : passe à l’alternative suivante puis revient au recommandé', () => {
    const s = traced(2);
    s.chooseAlt(nextAlt(s.alts!));
    expect(s.alts!.active).toBe(1);
    s.chooseAlt(nextAlt(s.alts!));
    expect(s.alts!.active).toBe(0);
    sameCoords(s.segments[0].coords, fx(0).coordinates);
  });
  it('les alternatives disparaissent dès le geste suivant', () => {
    const s = traced(2);
    expect(s.alts).not.toBeNull();
    s.add(W[2]);
    s.settle();
    expect(s.alts?.seg).not.toBe(0); // le tronçon 0 n'est plus proposé : le geste suivant remplace la portion
  });
  it('#1527 : après un glisser à 2 tronçons, les alternatives des deux sont proposées (aucune n’écrase l’autre), choix, annuler', () => {
    const s = traced(4);
    const target: LonLat = [W[1][0] + 0.001, W[1][1] + 0.001];
    const alt = (p: LonLat, q: LonLat, dy: number) => {
      const mid: Position = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + dy];
      return { best: [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + 0.0004], q] as Position[], alts: [{ coordinates: [p, mid, q] as Position[], deltaKm: 0.8, quality: 'gentler' as const }] };
    };
    const a = alt(W[0], target, 0.002);
    const b = alt(target, W[2], -0.002);
    s.stub(W[0], target, a.best, a.alts);
    s.stub(target, W[2], b.best, b.alts);
    s.dragPoint(1, target);
    s.settle();
    expect(s.altList.map((x) => x.seg).sort()).toEqual([0, 1]);
    s.chooseAlt(1, 0);
    s.chooseAlt(1, 1);
    expect(s.segments[0].coords).toBe(s.altList.find((x) => x.seg === 0)!.routes[1]);
    expect(s.altList).toHaveLength(2);
    s.undo();
    s.undo();
    expect(s.altList.map((x) => x.active)).toEqual([0, 0]);
  });
  it('indice d’alternative inexistant : sans effet', () => {
    const s = traced(2);
    expect(chooseAltResult(s.alts, 7)).toBeNull();
    expect(chooseAltResult(null, 0)).toBeNull();
  });
});

describe('scénarios éditeur : déviation sur une trace importée', () => {
  it('tirer un point d’une trace importée dévie ; toucher la déviation rétablit l’original', () => {
    const doc = docFromGeometry({ type: 'LineString', coordinates: FIXTURES[9].coordinates });
    const s = new EditorSim({ doc });
    const original = s.waypoints;
    const mid = Math.floor(original.length / 2);
    s.dragPoint(mid, [original[mid][0] + 0.001, original[mid][1] + 0.001]);
    expect(s.state.deviation).not.toBeNull();
    expect(s.waypoints.length).toBeLessThan(original.length);
    s.tapDeviation(original[mid]);
    expect(s.waypoints).toEqual(original);
    expect(s.state.deviation).toBeNull();
    expect(docGeometry(s.doc)!.coordinates.length).toBe(FIXTURES[9].coordinates.length);
  });
});

describe('scénarios éditeur : aimant', () => {
  const line = { coordinates: fx(0).coordinates };
  it('un point posé à 8 px d’un single s’accroche dessus', () => {
    const s = new EditorSim({ snap: true });
    s.singles = [line];
    const c = fx(0).coordinates[10];
    s.add(shiftPx([c[0], c[1]], 0) && [c[0], c[1] + 8 / 5000]);
    const w = s.waypoints[0];
    expect(Math.hypot(project(w).x - project([c[0], c[1]]).x, project(w).y - project([c[0], c[1]]).y)).toBeLessThan(2);
  });
  it('à 60 px, le point reste libre', () => {
    const s = new EditorSim({ snap: true });
    s.singles = [line];
    const p: LonLat = [fx(0).coordinates[10][0], fx(0).coordinates[10][1] + 60 / 5000];
    s.add(p);
    expect(s.waypoints[0]).toEqual(p);
  });
  it('aimant coupé : le point est posé tel quel', () => {
    const s = new EditorSim({ snap: false });
    s.singles = [line];
    const p: LonLat = [fx(0).coordinates[10][0], fx(0).coordinates[10][1] + 5 / 5000];
    s.add(p);
    expect(s.waypoints[0]).toEqual(p);
  });
  it('après routage, un point posé près du chemin est calé sur le début du tracé', () => {
    const s = new EditorSim({ snap: true });
    const coords = fx(0).coordinates;
    const start: LonLat = [coords[0][0], coords[0][1]];
    const end: LonLat = [coords.at(-1)![0], coords.at(-1)![1]];
    const off = shiftPx(start, 10);
    s.stub(off, end, coords, fx(0).alternatives);
    s.add(off);
    s.add(end);
    s.settle();
    expect(s.waypoints[0]).toEqual(start);
    expect(s.waypoints[1]).toEqual(end);
    expect(s.alts!.from).toEqual(start);
    expect(s.alts).not.toBeNull(); // la signature suit le point calé
  });
  it('un point trop loin du chemin (60 px) reste hors-piste', () => {
    const s = new EditorSim({ snap: true });
    const coords = fx(0).coordinates;
    const start: LonLat = [coords[0][0], coords[0][1]];
    const end: LonLat = [coords.at(-1)![0], coords.at(-1)![1]];
    const off = shiftPx(start, 60);
    s.stub(off, end, coords);
    s.add(off);
    s.add(end);
    s.settle();
    expect(s.waypoints[0]).toEqual(off);
  });
});

describe('scénarios éditeur : points posés exactement sur une route', () => {
  const onRoute: LonLat[] = [FIXTURES[12].from, FIXTURES[13].from, FIXTURES[14].from, FIXTURES[14].to];
  it('trois tronçons contigus enchaînent sans trou, waypoints inchangés', () => {
    const s = new EditorSim({ snap: false });
    onRoute.forEach((p) => s.add(p));
    s.settle();
    expect(s.waypoints).toEqual(onRoute);
    expect(s.segments.map((x) => x.coords!.length)).toEqual([FIXTURES[12], FIXTURES[13], FIXTURES[14]].map((f) => f.coordinates.length));
    const g = s.geometry!.coordinates;
    expect(g[0]).toEqual(FIXTURES[12].coordinates[0]);
    expect(g.at(-1)).toEqual(FIXTURES[14].coordinates.at(-1));
  });
  it('ces points appartiennent bien au tracé du tronçon d’où ils viennent', () => {
    const ids = new Set(fx(0).coordinates.map((c) => `${c[0]},${c[1]}`));
    expect(ids.has(`${onRoute[0][0]},${onRoute[0][1]}`)).toBe(true);
    expect(ids.has(`${onRoute[1][0]},${onRoute[1][1]}`)).toBe(true);
  });
  it('resolveRouted : écart nul ⇒ aucune action de calage', () => {
    const s = new EditorSim({ snap: true });
    onRoute.slice(0, 2).forEach((p) => s.add(p));
    const r = resolveRouted({ doc: s.doc, rider: 'muscle', i: 0, from: onRoute[0], to: onRoute[1], coords: FIXTURES[12].coordinates, alts: [], snap: { project, tolPx: 24 } });
    expect(r.actions.map((a) => a.type)).toEqual(['resolved']);
    expect(r.altSet).toBeNull();
  });
});
