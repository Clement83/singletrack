import { describe, expect, it } from 'vitest';
import { deviateWaypoint, docFromGeometry, docFromStoredWithGeometry, docToStored, docGeometry, moveWaypoint, pendingSegments, type EditorDoc, type LonLat } from '@/lib/editor/doc';

// #1526: on reopening, the saved line is reused, only the modified part is recomputed.
const A: LonLat = [6, 43], B: LonLat = [6.01, 43], C: LonLat = [6.01, 43.01], D: LonLat = [6, 43];
const P = (p: number[]): [number, number, number] => [p[0], p[1], 0];
const line = (a: LonLat, m: LonLat, b: LonLat) => [a, m, b].map(P);
const geometry = { type: 'LineString' as const, coordinates: [...line(A, [6.005, 43.001], B), [6.012, 43.005], C, [6.005, 43.012], D].map(P) };
const stored = { waypoints: [A, B, C, D], modes: ['route', 'route', 'route'] as ('route')[] };

describe('docFromStoredWithGeometry', () => {
  it('reprend le tracé de chaque tronçon, sans rien recalculer', () => {
    const doc = docFromStoredWithGeometry(stored, geometry);
    expect(pendingSegments(doc)).toEqual([]);
    expect(docGeometry(doc)!.coordinates).toEqual(geometry.coordinates);
  });
  it('déplacer un point au milieu ne recalcule que ses deux tronçons', () => {
    const doc: EditorDoc = moveWaypoint(docFromStoredWithGeometry(stored, geometry), 2, [6.02, 43.02]);
    expect(pendingSegments(doc)).toEqual([1, 2]);
    expect(doc.segments[0].coords).toEqual(line(A, [6.005, 43.001], B));
  });
  it('waypoint introuvable : tronçons voisins à recalculer', () => {
    const doc = docFromStoredWithGeometry({ ...stored, waypoints: [A, [7, 44], C, D] }, geometry);
    expect(pendingSegments(doc)).toEqual([0, 1]);
    expect(doc.segments[2].coords).not.toBeNull();
  });
});

// #1686: frozen segments (import/copy) vs deliberate straight lines.
describe('segments figés (#1686)', () => {
  const imported = () => docFromGeometry({ type: 'LineString', coordinates: [[6, 43, 0], [6.003, 43.002, 0], [6.006, 43, 0], [6.009, 43.002, 0], [6.012, 43, 0]] }, 5);
  it('déplacer une extrémité d\'un segment figé long passe les voisins en route', () => {
    const d = imported();
    expect(d.segments.every((x) => x.mode === 'line' && x.coords)).toBe(true);
    const { doc } = deviateWaypoint(d, 2, [6.007, 43.001]);
    // no straight line without a route: every segment without coords is to be routed
    const bare = doc.segments.flatMap((x, k) => (!x.coords ? [k] : []));
    expect(bare.length).toBeGreaterThan(0);
    expect(pendingSegments(doc)).toEqual(bare);
  });
  it('une ligne droite voulue reste une ligne droite', () => {
    const d: EditorDoc = { waypoints: [A, B, C], segments: [{ mode: 'line', coords: null }, { mode: 'line', coords: null }] };
    expect(moveWaypoint(d, 1, [6.02, 43]).segments.map((x) => x.mode)).toEqual(['line', 'line']);
  });
  it('réouverture : les segments figés retrouvent leur tracé, la ligne voulue non', () => {
    const g = { type: 'LineString' as const, coordinates: [P(A), P([6.005, 43.004]), P(B), P([6.01, 43.005]), P(C)] };
    const st = { waypoints: [A, B, C], modes: ['line', 'line'] as ('line')[], frozen: [true, false] };
    const doc = docFromStoredWithGeometry(st, g);
    expect(doc.segments[0].coords).toHaveLength(3);
    expect(doc.segments[1].coords).toBeNull();
    expect(docToStored(doc).frozen).toEqual([true, false]);
  });
  it('ancien format (sans frozen) : un tronçon courbe est figé, un droit non', () => {
    const g = { type: 'LineString' as const, coordinates: [P(A), P([6.005, 43.004]), P(B), P([6.005, 43.0]), P(C)] };
    const doc = docFromStoredWithGeometry({ waypoints: [A, B, C], modes: ['line', 'line'] }, g);
    expect(doc.segments[0].coords).not.toBeNull();
  });
});
