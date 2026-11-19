import { describe, expect, it } from 'vitest';
import { docFromStoredWithGeometry, docGeometry, moveWaypoint, pendingSegments, type EditorDoc, type LonLat } from '@/lib/editor/doc';

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
