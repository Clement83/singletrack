import { describe, it, expect } from 'vitest';
import type { Position } from '@/lib/geo';
import { densify, docGeometry, type LonLat } from '@/lib/editor/doc';
import { freezeCuts, maxDeviation } from '@/lib/editor/freeze';
import { EditorSim } from './helpers/editor-sim';

/** Validated path frozen by waypoints (#1812). Straight road A→B at y = 43.2; the alternative goes around by the south (y = 43.19). */
const Y = 43.2;
const YP = 43.19;
const A: LonLat = [6.0, Y];
const B: LonLat = [6.1, Y];
const poly = (...pts: LonLat[]): Position[] => pts.flatMap((p, k) => (k ? densify(pts[k - 1], p, 80).slice(1) : [p]));
const MAIN = poly(A, B);
const DETOUR = poly(A, [6.03, YP], [6.07, YP], B);
const key = (c: Position) => `${c[0]},${c[1]}`;

function build() {
  const s = new EditorSim();
  s.stub(A, B, MAIN, [{ coordinates: DETOUR, deltaKm: 1.4, quality: 'similar' }]);
  // Network = the detour: two of its vertices are joined by the line between them (BRouter follows the roads).
  s.router = (from, to) => {
    const i = DETOUR.findIndex((c) => key(c) === key(from));
    const j = DETOUR.findIndex((c) => key(c) === key(to));
    return i >= 0 && j > i && !(i === 0 && j === DETOUR.length - 1) ? DETOUR.slice(i, j + 1) : null;
  };
  s.add(A);
  s.add(B);
  s.settle();
  return s;
}

describe('tracé validé figé par des points de passage (#1812)', () => {
  it('une alternative choisie est figée avec le minimum de points, géométrie identique', async () => {
    const s = build();
    expect(s.alts).not.toBeNull();
    s.chooseAlt(1);
    expect(s.state.toFreeze).toHaveLength(1);
    await s.freeze();
    expect(s.state.toFreeze).toHaveLength(0);
    expect(s.waypoints.length).toBeGreaterThan(2);
    expect(s.waypoints.length).toBeLessThanOrEqual(4); // two corners at most, not a point every 80 m
    expect(s.geometry!.coordinates).toEqual(DETOUR);
    expect(s.waypoints[0]).toEqual(A);
    expect(s.waypoints.at(-1)).toEqual(B);
    expect(s.altList).toHaveLength(0); // no more alternatives after validation
  });

  it('les points ajoutés sont des points normaux : ailleurs, la trace figée ne bouge pas', async () => {
    const s = build();
    s.chooseAlt(1);
    await s.freeze();
    s.add([6.2, Y]);
    s.settle();
    const n = DETOUR.length;
    expect(s.geometry!.coordinates.slice(0, n)).toEqual(DETOUR);
    // movable: moving the added point only recomputes its neighbours
    s.dragPoint(1, [6.031, YP]);
    s.settle();
    expect(s.waypoints).toHaveLength(s.state.present.waypoints.length);
  });

  it('annuler après la validation revient à avant le choix (une seule étape)', async () => {
    const s = build();
    const doc0 = s.doc;
    const n = s.state.past.length;
    s.chooseAlt(1);
    await s.freeze();
    expect(s.state.past).toHaveLength(n + 1);
    s.undo();
    expect(s.doc).toBe(doc0);
    expect(s.state.toFreeze).toHaveLength(0);
  });

  it('un nouveau glisser après validation repropose des alternatives', async () => {
    const s = build();
    s.chooseAlt(1);
    await s.freeze();
    const P: LonLat = [6.05, 43.185];
    const [, c1] = s.waypoints;
    s.stub(A, P, poly(A, P), [{ coordinates: poly(A, [6.02, 43.19], P), deltaKm: 0.3, quality: 'similar' }]);
    s.stub(c1, P, poly(c1, P), [{ coordinates: poly(c1, [6.04, 43.19], P), deltaKm: 0.3, quality: 'similar' }]);
    s.dragPoint(1, P);
    s.settle();
    expect(s.altList.length).toBeGreaterThan(0);
  });

  it('valider sans paire active ne fige rien', async () => {
    const s = new EditorSim({ choice: true });
    const path = poly(A, [6.03, YP], B);
    s.stub(A, B, path);
    s.add(A);
    s.add(B);
    s.settle();
    s.dispatch({ type: 'commitChoice' }); // no pair: nothing to freeze
    expect(s.state.toFreeze).toHaveLength(0);
  });
});

describe('freezeCuts / maxDeviation', () => {
  it('aucun point si BRouter redonne la ligne', async () => {
    expect(await freezeCuts(MAIN, async (a, b) => (key(a) === key(MAIN[0]) && key(b) === key(MAIN.at(-1)!) ? MAIN : null))).toEqual([]);
  });
  it('plafonne les points quand BRouter ne suit jamais la ligne', async () => {
    const cuts = await freezeCuts(DETOUR, async () => null, 8, 5);
    expect(cuts.length).toBeLessThanOrEqual(5);
  });
  it('maxDeviation mesure l’écart max', () => {
    expect(maxDeviation(MAIN, MAIN).d).toBeLessThan(0.01);
    expect(maxDeviation(DETOUR, MAIN).d).toBeGreaterThan(1000);
  });
  it('docGeometry reste cohérente', () => {
    expect(docGeometry({ waypoints: [], segments: [] })).toBeNull();
  });
});
