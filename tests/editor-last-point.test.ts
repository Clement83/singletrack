import { describe, it, expect } from 'vitest';
import { docFromGeometry, deviateWaypoint, removeWaypoint, moveWaypoint, docGeometry, addWaypoint, emptyDoc, type LonLat } from '@/lib/editor/doc';
import { editorReducer, initialState, type EditorState } from '@/lib/editor/state';

const line = Array.from({ length: 110 }, (_, k) => [6.0 + k * 0.00125, 43.2 + 0.004 * Math.sin(k / 4)] as [number, number]);
const doc0 = docFromGeometry({ type: 'LineString', coordinates: line }, 60);

describe('dernier point (#1466)', () => {
  it('supprimer l’arrivée : l’avant-dernier devient l’arrivée', () => {
    const n = doc0.waypoints.length;
    const out = removeWaypoint(doc0, n - 1);
    expect(out.waypoints).toEqual(doc0.waypoints.slice(0, n - 1));
    expect(out.segments).toHaveLength(n - 2);
  });
  it('déplacer l’arrivée (déviation) garde un document cohérent', () => {
    const n = doc0.waypoints.length;
    const p: LonLat = [doc0.waypoints[n - 1][0], doc0.waypoints[n - 1][1] + 0.003];
    const { doc, deviation } = deviateWaypoint(doc0, n - 1, p, 400);
    expect(deviation).not.toBeNull();
    expect(doc.waypoints.at(-1)).toEqual(p);
    expect(doc.segments).toHaveLength(doc.waypoints.length - 1);
    expect(docGeometry(doc)).not.toBeNull();
  });
  it('trace à la main : déplacer et supprimer l’arrivée', () => {
    let d = emptyDoc();
    for (const p of [[6, 43], [6.001, 43], [6.002, 43]] as LonLat[]) d = addWaypoint(d, p, 'route');
    expect(moveWaypoint(d, 2, [6.002, 43.001]).waypoints[2]).toEqual([6.002, 43.001]);
    let s: EditorState = { ...initialState(d), selected: 2 };
    s = editorReducer(s, { type: 'remove', i: 2 });
    expect(s.present.waypoints).toHaveLength(2);
    s = editorReducer(s, { type: 'deviate', i: 1, p: [6.001, 43.002] });
    expect(s.present.waypoints.at(-1)).toEqual([6.001, 43.002]);
  });
});
