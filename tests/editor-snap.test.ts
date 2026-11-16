import { describe, it, expect } from 'vitest';
import { projectOnSegment, snapEndpoint, snapToGroups, snapTolerance, type SnapGroup } from '@/lib/editor/snap';
import { addWaypoint, emptyDoc, snapWaypoint, type LonLat } from '@/lib/editor/doc';
import { snapPointIn, moveLineDrag } from '@/lib/editor/gestures';
import { editorReducer, initialState } from '@/lib/editor/state';

// Projection écran factice : 1 degré = 1000 px.
const project = (c: number[]) => ({ x: c[0] * 1000, y: -c[1] * 1000 });
const at = (lon: number, lat: number) => project([lon, lat]);
const line = (...c: [number, number][]) => ({ coordinates: c });

describe('aimant : projection sur le segment', () => {
  it('projette au milieu du segment, pas au sommet', () => {
    const r = projectOnSegment({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(r.t).toBeCloseTo(0.5);
    expect(r.dist).toBeCloseTo(10);
  });
  it('borne aux extrémités et gère un segment nul', () => {
    expect(projectOnSegment({ x: -20, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }).t).toBe(0);
    expect(projectOnSegment({ x: 5, y: 5 }, { x: 1, y: 1 }, { x: 1, y: 1 }).t).toBe(0);
  });
});

describe('aimant : snapToGroups', () => {
  const singles: SnapGroup = { id: 'singles', lines: [line([6.0, 43.0], [6.1, 43.0])] }; // longue ligne droite, 100 px
  it('aimante au point le plus proche d’une longue ligne droite (pas à un sommet)', () => {
    const hit = snapToGroups(at(6.05, 43.0 + 0.01), [singles], project, 24)!;
    expect(hit.group).toBe('singles');
    expect(hit.point[0]).toBeCloseTo(6.05);
    expect(hit.point[1]).toBeCloseTo(43.0);
    expect(hit.distPx).toBeCloseTo(10);
  });
  it('reste libre au-delà de la tolérance', () => {
    expect(snapToGroups(at(6.05, 43.0 + 0.03), [singles], project, 24)).toBeNull();
  });
  it('tolérance : 24 px au doigt, 10 px à la souris', () => {
    const p = at(6.05, 43.0 + 0.015); // 15 px
    expect(snapToGroups(p, [singles], project, snapTolerance(false))).not.toBeNull();
    expect(snapToGroups(p, [singles], project, snapTolerance(true))).toBeNull();
  });
  it('priorité : le premier groupe à portée gagne, même si le suivant est plus proche', () => {
    const own: SnapGroup = { id: 'own', lines: [line([6.0, 43.002], [6.1, 43.002])] };
    const p = at(6.05, 43.0015);
    expect(snapToGroups(p, [singles, own], project, 24)!.group).toBe('singles');
    expect(snapToGroups(p, [own, singles], project, 24)!.group).toBe('own');
  });
  it('retient la ligne la plus proche dans un groupe, et se rabat sur le groupe suivant', () => {
    const g: SnapGroup = { id: 'singles', lines: [line([6.0, 43.02], [6.1, 43.02]), line([6.0, 43.004], [6.1, 43.004])] };
    expect(snapToGroups(at(6.05, 43.0), [g], project, 24)!.point[1]).toBeCloseTo(43.004);
    const own: SnapGroup = { id: 'own', lines: [line([6.0, 43.001], [6.1, 43.001])] };
    expect(snapToGroups(at(6.05, 43.0), [{ id: 'singles', lines: [] }, own], project, 24)!.group).toBe('own');
  });
  it('ignore une ligne dégénérée et respecte l’emprise de pré-filtrage', () => {
    expect(snapToGroups(at(6, 43), [{ id: 'a', lines: [line([6, 43])] }], project, 24)).toBeNull();
    const far = snapToGroups(at(6.05, 43.01), [singles], project, 24, [7, 44, 8, 45]);
    expect(far).toBeNull();
    const near = snapToGroups(at(6.05, 43.01), [singles], project, 24, [6.04, 42.98, 6.06, 43.03]);
    expect(near).not.toBeNull();
  });
});

describe('aimant BRouter : snapEndpoint', () => {
  const wp: LonLat = [6.0, 43.0];
  it('ramène le point sur le début du tracé s’il est à portée', () => {
    expect(snapEndpoint(wp, [6.01, 43.0], project, 24)).toEqual([6.01, 43.0]); // 10 px
  });
  it('laisse libre un point hors-piste (trop loin) ou déjà dessus', () => {
    expect(snapEndpoint(wp, [6.05, 43.0], project, 24)).toBeNull();
    expect(snapEndpoint(wp, [6.0, 43.0], project, 24)).toBeNull();
  });
});

describe('aimant : action snapEnd', () => {
  const A: LonLat = [6, 43];
  const B: LonLat = [6.01, 43];
  const base = () => [A, B].reduce((d, p) => addWaypoint(d, p, 'route'), emptyDoc());
  it('déplace le waypoint sans historique ni invalidation du tracé', () => {
    let s = initialState(base());
    s = editorReducer(s, { type: 'resolved', seg: 0, from: A, to: B, coords: [A, B] });
    const past = s.past.length;
    s = editorReducer(s, { type: 'snapEnd', i: 1, from: B, p: [6.0102, 43.0001] });
    expect(s.present.waypoints[1]).toEqual([6.0102, 43.0001]);
    expect(s.present.segments[0].coords).toEqual([A, B]);
    expect(s.past.length).toBe(past);
  });
  it('ignore un point qui a bougé depuis le calcul', () => {
    const s = initialState(base());
    expect(editorReducer(s, { type: 'snapEnd', i: 1, from: [9, 9], p: [1, 1] })).toBe(s);
    expect(snapWaypoint(emptyDoc(), 3, A)).toEqual(emptyDoc());
  });
});

describe('zones de clic de la trace (#1524)', () => {
  it('étroites à la souris, larges au doigt', async () => {
    const { hitWidth } = await import('@/lib/editor/snap');
    expect(hitWidth(true)).toBe(8);
    expect(hitWidth(false)).toBe(28);
  });
});

describe('#1525 : aimant au plus proche, glisser de ligne', () => {
  const env = { project: (c: number[]) => project(c), unproject: (q: [number, number]) => ({ lng: q[0] / 1000, lat: -q[1] / 1000 }), tolPx: 10 };
  it('une trace à 2 px bat un single à 8 px (la distance prime sur le groupe)', () => {
    let doc = addWaypoint(emptyDoc(), [6.0, 43.002], 'line');
    doc = addWaypoint(doc, [6.1, 43.002], 'line');
    const single = line([6.0, 43.008], [6.1, 43.008]);
    const r = snapPointIn([6.05, 43.0], doc, [single], env, [])!;
    expect(r[1]).toBeCloseTo(43.002);
    const r2 = snapPointIn([6.05, 43.0 + 0.0072], doc, [single], env, [])!;
    expect(r2[1]).toBeCloseTo(43.008); // single plus proche : il gagne
  });
  it('le glisser de ligne ne s’annule plus sur buttons === 0', () => {
    const d = { seg: 0, x: 0, y: 0, p: [6, 43] as [number, number], moved: false };
    expect(moveLineDrag(d, { x: 20, y: 0 }, [6.01, 43])).toMatchObject({ moved: true, p: [6.01, 43] });
  });
});
