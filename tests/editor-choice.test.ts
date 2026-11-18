import { describe, it, expect } from 'vitest';
import type { Position } from '@/lib/geo';
import { densify, type LonLat } from '@/lib/editor/doc';
import { choiceDeltas, choiceOptions, choiceSegs } from '@/lib/editor/choice';
import { EditorSim } from './helpers/editor-sim';

/**
 * Déviation élargie aux points posés à la main (#1641). Schéma : route principale (y = 43.2) de x = 6.00 à 6.10,
 * carrefours en 6.015 et 6.075, route parallèle 1 km au sud entre les deux.
 */
const Y = 43.2;
const YP = 43.19;
const poly = (...pts: LonLat[]): Position[] => pts.flatMap((p, k) => (k ? densify(pts[k - 1], p, 80).slice(1) : [p]));
const main = (a: number, b: number) => poly([a, Y], [b, Y]);
const X = [6.0, 6.01, 6.02, 6.03, 6.04, 6.05, 6.06, 6.07, 6.09, 6.1]; // 6.04 = point « 1 » ; 5 étoiles entre les carrefours
const P: LonLat = [6.045, YP];

function build(opts: { choice?: boolean } = {}) {
  const s = new EditorSim({ choice: opts.choice ?? true });
  for (let k = 1; k < X.length; k++) s.stub([X[k - 1], Y], [X[k], Y], main(X[k - 1], X[k]));
  X.forEach((x) => s.add([x, Y]));
  s.settle();
  // Routage vers la parallèle depuis n'importe quelle ancre : principale jusqu'au carrefour, puis la parallèle.
  for (const x of X.filter((v) => v < 6.015)) s.stub([x, Y], P, [...main(x, 6.015), ...poly([6.015, Y], [6.015, YP], P).slice(1)]);
  for (const x of X.filter((v) => v > 6.075)) s.stub(P, [x, Y], [...poly(P, [6.075, YP], [6.075, Y]), ...main(6.075, x).slice(1)]);
  return s;
}
const before = () => build({ choice: false });

describe('déviation élargie aux points posés à la main (#1641)', () => {
  it('« nouveau » saute les 5 étoiles et passe par la parallèle ; « ancien » = état d’avant', () => {
    const s = build();
    const doc0 = s.doc;
    s.dragPoint(4, P);
    expect(s.state.choice).not.toBeNull();
    expect(s.waypoints).toEqual([[6.0, Y], [6.01, Y], P, [6.09, Y], [6.1, Y]]);
    s.settle();
    const lat = s.geometry!.coordinates.map((c) => c[1]);
    expect(Math.min(...lat)).toBeCloseTo(YP, 6);
    expect(s.state.choice!.old).toBe(doc0);
    const [nw, old] = choiceOptions(s.state.choice!);
    expect(nw.doc.waypoints).toHaveLength(5);
    expect(old.doc.waypoints).toEqual(doc0.waypoints);
    expect(nw.stats.distanceM).toBeGreaterThan(old.stats.distanceM);
    expect(old.stats.distanceM).toBeGreaterThan(0); // pas d’altitude dans ces fixtures : D+ et profil vides
  });

  it('choisir l’ancien restaure exactement, sans historique ; re-choisir le nouveau aussi', () => {
    const s = build();
    const doc0 = s.doc;
    s.dragPoint(4, P);
    s.settle();
    const created = s.state.past.length;
    s.dispatch({ type: 'selectChoice', which: 'old' });
    expect(s.doc).toBe(doc0);
    expect(s.state.past).toHaveLength(created);
    s.dispatch({ type: 'selectChoice', which: 'new' });
    expect(s.waypoints).toHaveLength(5);
    expect(s.state.past).toHaveLength(created);
  });

  it('commitChoice : une seule entrée d’historique ; annuler = avant le glisser ; rétablir', () => {
    const s = build();
    const doc0 = s.doc;
    const n = s.state.past.length;
    s.dragPoint(4, P);
    s.settle();
    s.dispatch({ type: 'commitChoice' });
    expect(s.state.choice).toBeNull();
    expect(s.state.past).toHaveLength(n + 1);
    expect(s.waypoints).toHaveLength(5);
    s.undo();
    expect(s.doc).toBe(doc0);
    s.redo();
    expect(s.waypoints).toHaveLength(5);
  });

  it('annuler pendant le choix revient exactement à l’avant-glisser', () => {
    const s = build();
    const doc0 = s.doc;
    s.dragPoint(4, P);
    s.undo();
    expect(s.doc).toBe(doc0);
    expect(s.state.choice).toBeNull();
    expect(s.state.past).toHaveLength(build().state.past.length);
  });

  it('un geste suivant valide l’option sélectionnée (et « ancien » aussi)', () => {
    const s = build();
    s.dragPoint(4, P);
    s.settle();
    s.add([6.11, Y]);
    expect(s.state.choice).toBeNull();
    expect(s.waypoints).toHaveLength(6);
    const t = build();
    const doc0 = t.doc;
    t.dragPoint(4, P);
    t.dispatch({ type: 'selectChoice', which: 'old' });
    t.add([6.11, Y]);
    expect(t.waypoints).toEqual([...doc0.waypoints, [6.11, Y]]);
    t.undo();
    expect(t.doc).toBe(doc0);
  });

  it('le glisser de la ligne fait de même ; l’ancien est identique à l’avant', () => {
    const s = build();
    const doc0 = s.doc;
    s.dragLine(4, [6.045, Y], P);
    expect(s.state.choice).not.toBeNull();
    expect(s.waypoints).toContainEqual(P);
    expect(s.waypoints).toHaveLength(5);
    s.dispatch({ type: 'selectChoice', which: 'old' });
    expect(s.doc).toBe(doc0);
  });

  it('pas d’alternatives BRouter pour la portion tant que la paire est active', () => {
    const s = build();
    s.stub([6.01, Y], P, [...main(6.01, 6.015), ...poly([6.015, Y], [6.015, YP], P).slice(1)], [{ coordinates: poly([6.01, Y], [6.01, YP], P), deltaKm: 0.5, quality: 'similar' }]);
    s.dragPoint(4, P);
    s.settle();
    expect(s.altList).toHaveLength(0);
    s.dispatch({ type: 'commitChoice' });
    expect(s.altList.length).toBeGreaterThan(0);
  });

  it('plafond : si le nouveau tracé ne rejoint pas l’ancien dans les plafonds, comportement habituel', () => {
    const s = build();
    // routes sans aucun point commun avec l’ancien tracé
    for (const x of X) {
      s.stub([x, Y], P, poly([x, Y], [x, 43.1], P));
      s.stub(P, [x, Y], poly(P, [x, 43.1], [x, Y]));
    }
    s.dragPoint(4, P);
    expect(s.state.choice).toBeNull();
    expect(s.waypoints).toEqual([[6.0, Y], [6.01, Y], [6.02, Y], [6.03, Y], P, [6.05, Y], [6.06, Y], [6.07, Y], [6.09, Y], [6.1, Y]]);
    expect(s.state.past).toHaveLength(before().state.past.length + 1);
  });

  it('un point posé sur l’ancien tracé n’ouvre pas de paire', () => {
    const s = build();
    s.dragPoint(4, [6.041, Y]);
    expect(s.state.choice).toBeNull();
  });

  it('tronçons et écarts de chaque option (#1642) : « nouveau » plus long, symétrique pour « ancien »', () => {
    const s = build();
    s.dragPoint(4, P);
    s.settle();
    const c = s.state.choice!;
    expect(choiceSegs(c, 'new')).toEqual(c.newSegs);
    expect(choiceSegs(c, 'old')).toHaveLength(c.oldSegs[1] - c.oldSegs[0]);
    expect(choiceSegs(c, 'old').length).toBeGreaterThan(0);
    const d = choiceDeltas(c);
    expect(d.new.km).toBeGreaterThan(0);
    expect(d.old.km).toBeCloseTo(-d.new.km, 9);
    // Sélectionner « ancien » ne change pas les écarts : la valeur est relative à l'autre option, pas à l'affichage.
    s.dispatch({ type: 'selectChoice', which: 'old' });
    expect(choiceDeltas(s.state.choice!).new.km).toBeCloseTo(d.new.km, 6);
  });
});
