import { describe, it, expect } from 'vitest';
import { docFromGeometry, docGeometry, deviateWaypoint, restoreDeviation, addWaypoint, emptyDoc, type LonLat } from '@/lib/editor/doc';
import { editorReducer, initialState } from '@/lib/editor/state';

/** Trace droite d'environ 12 km vers l'est, un sommet tous les ~110 m, sinueuse pour que la simplification garde des waypoints. */
const line = Array.from({ length: 110 }, (_, k) => [6.0 + k * 0.00125, 43.2 + 0.004 * Math.sin(k / 4)] as [number, number]);
const geom = { type: 'LineString' as const, coordinates: line };

describe('déviation au glisser (#1451)', () => {
  it('retire les waypoints d’origine de la fenêtre et garde des ancres', () => {
    const doc = docFromGeometry(geom, 60);
    const i = Math.floor(doc.waypoints.length / 2);
    const p: LonLat = [doc.waypoints[i][0], doc.waypoints[i][1] + 0.003];
    const { doc: out, deviation } = deviateWaypoint(doc, i, p, 400);
    expect(deviation).not.toBeNull();
    expect(out.waypoints.length).toBeLessThan(doc.waypoints.length);
    expect(out.waypoints).toContainEqual(p);
    expect(out.segments).toHaveLength(out.waypoints.length - 1);
    const k = out.waypoints.findIndex((w) => w === p);
    expect(out.segments[k - 1]).toEqual({ mode: 'route', coords: null });
    expect(out.segments[k]).toEqual({ mode: 'route', coords: null });
    // l'ancien parcours va d'ancre à ancre en passant par l'ancien point
    expect(deviation!.path[0]).toEqual(out.waypoints[k - 1]);
    expect(deviation!.path.at(-1)).toEqual(out.waypoints[k + 1]);
  });

  it('restaure exactement le parcours d’origine', () => {
    const doc = docFromGeometry(geom, 60);
    const i = Math.floor(doc.waypoints.length / 2);
    const { doc: out, deviation } = deviateWaypoint(doc, i, [doc.waypoints[i][0], doc.waypoints[i][1] + 0.003]);
    expect(restoreDeviation(out, deviation!)).toEqual(doc);
    expect(docGeometry(restoreDeviation(out, deviation!))!.coordinates).toEqual(docGeometry(doc)!.coordinates);
  });

  it('une trace faite à la main (segments chemins) garde le déplacement habituel', () => {
    let d = emptyDoc();
    for (const p of [[6, 43], [6.001, 43], [6.002, 43], [6.003, 43]] as LonLat[]) d = addWaypoint(d, p, 'route');
    const { doc, deviation } = deviateWaypoint(d, 2, [6.002, 43.001]);
    expect(deviation).toBeNull();
    expect(doc.waypoints).toHaveLength(4);
  });

  it('fonctionne aux extrémités', () => {
    const doc = docFromGeometry(geom, 60);
    const first = deviateWaypoint(doc, 0, [6.0, 43.21]);
    expect(first.doc.waypoints[0]).toEqual([6.0, 43.21]);
    expect(restoreDeviation(first.doc, first.deviation!)).toEqual(doc);
    const n = doc.waypoints.length - 1;
    const last = deviateWaypoint(doc, n, [6.2, 43.21]);
    expect(restoreDeviation(last.doc, last.deviation!)).toEqual(doc);
  });

  it('une seule entrée d’historique ; annuler revient à l’avant-déviation ; l’origine se rétablit', () => {
    const doc = docFromGeometry(geom, 60);
    const i = Math.floor(doc.waypoints.length / 2);
    let s = initialState(doc);
    s = editorReducer(s, { type: 'deviate', i, p: [doc.waypoints[i][0], doc.waypoints[i][1] + 0.003] });
    expect(s.past).toHaveLength(1);
    expect(s.deviation).not.toBeNull();
    const dev = editorReducer(s, { type: 'restoreDeviation' });
    expect(dev.present).toEqual(doc);
    expect(dev.deviation).toBeNull();
    const undone = editorReducer(s, { type: 'undo' });
    expect(undone.present).toBe(doc);
    expect(undone.deviation).toBeNull();
  });

  it('le glisser de la ligne insère puis dévie en un geste', () => {
    const doc = docFromGeometry(geom, 60);
    let s = initialState(doc);
    s = editorReducer(s, { type: 'deviate', seg: 5, i: 0, p: [6.05, 43.205] });
    expect(s.past).toHaveLength(1);
    expect(s.present.waypoints).toContainEqual([6.05, 43.205]);
    expect(s.deviation).not.toBeNull();
  });
});
