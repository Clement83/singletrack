import { describe, it, expect, vi } from 'vitest';
import {
  addWaypoint, closeLoop, docFromGeometry, docFromStored, docGeometry, emptyDoc, insertWaypoint, moveWaypoint, parseStored,
  pendingSegments, prependHome, removeWaypoint, resolveSegment, reverseDoc, setSegmentMode, trimAfter, trimBefore, type EditorDoc, type LonLat,
} from '@/lib/editor/doc';
import { editorReducer, initialState } from '@/lib/editor/state';
import { liveStats } from '@/lib/editor/stats';
import { buildRouteUrl, parseRoute, routeBetween, RoutingError } from '@/lib/routing/brouter';
import { lineLength } from '@/lib/geo';

const A: LonLat = [6.14, 43.22];
const B: LonLat = [6.15, 43.22];
const C: LonLat = [6.15, 43.23];
const D: LonLat = [6.14, 43.23];
const build = (pts: LonLat[], mode: 'route' | 'line' = 'line') => pts.reduce((d, p) => addWaypoint(d, p, mode), emptyDoc());

describe('document de l’éditeur', () => {
  it('ajoute des points et des segments', () => {
    const d = build([A, B, C]);
    expect(d.waypoints).toHaveLength(3);
    expect(d.segments).toHaveLength(2);
    expect(docGeometry(build([A]))).toBeNull();
    expect(docGeometry(d)!.coordinates).toEqual([A, B, C]);
  });

  it('les segments « chemins » restent à calculer jusqu’à résolution, et ignorent un résultat périmé', () => {
    let d = build([A, B, C], 'route');
    expect(pendingSegments(d)).toEqual([0, 1]);
    const line = [[...A, 100], [6.145, 43.221, 120], [...B, 130]] as [number, number, number][];
    d = resolveSegment(d, 0, A, B, line);
    expect(pendingSegments(d)).toEqual([1]);
    expect(docGeometry(d)!.coordinates.slice(0, 3)).toEqual(line); // junction not duplicated
    // point B moved in the meantime: the received line is no longer valid
    const moved = moveWaypoint(d, 1, [6.16, 43.2]);
    expect(resolveSegment(moved, 0, A, B, line)).toBe(moved);
  });

  it('déplacer un point invalide les deux segments voisins seulement', () => {
    let d = build([A, B, C, D], 'route');
    d = { ...d, segments: d.segments.map(() => ({ mode: 'route' as const, coords: [A, B] })) };
    const m = moveWaypoint(d, 1, [6.151, 43.221]);
    expect(m.segments.map((s) => s.coords === null)).toEqual([true, true, false]);
  });

  it('insère un point sur la ligne en conservant le tracé calculé', () => {
    const d: EditorDoc = {
      waypoints: [A, C],
      segments: [{ mode: 'route', coords: [A, [6.141, 43.221], [6.145, 43.225], [6.149, 43.229], C] }],
    };
    const r = insertWaypoint(d, 0, [6.1451, 43.2251]);
    expect(r.waypoints[1]).toEqual([6.145, 43.225]);
    expect(r.segments[0].coords).toHaveLength(3);
    expect(r.segments[1].coords).toHaveLength(3);
    expect(docGeometry(r)!.coordinates).toEqual(d.segments[0].coords);
  });

  it('supprime un point : fusion des voisins au milieu, segment retiré aux extrémités', () => {
    const d = build([A, B, C, D]);
    expect(removeWaypoint(d, 1).waypoints).toEqual([A, C, D]);
    expect(removeWaypoint(d, 1).segments).toHaveLength(2);
    expect(removeWaypoint(d, 0).waypoints).toEqual([B, C, D]);
    expect(removeWaypoint(d, 3).segments).toHaveLength(2);
    expect(removeWaypoint(build([A]), 0)).toEqual(emptyDoc());
  });

  it('inverse, ferme la boucle, ajoute la maison, coupe', () => {
    const d = build([A, B, C]);
    const rev = reverseDoc(d);
    expect(rev.waypoints).toEqual([C, B, A]);
    const closed = closeLoop(d, 'line');
    expect(closed.waypoints.at(-1)).toEqual(A);
    expect(closeLoop(closed, 'line')).toBe(closed);
    const withHome = prependHome(d, D, 'route');
    expect(withHome.waypoints[0]).toEqual(D);
    expect(withHome.segments[0].mode).toBe('route');
    expect(prependHome(withHome, D, 'route')).toBe(withHome);
    expect(trimBefore(d, 1).waypoints).toEqual([B, C]);
    expect(trimAfter(d, 1).waypoints).toEqual([A, B]);
    expect(trimAfter(d, 2)).toBe(d);
  });

  it('changer le mode d’un segment efface son tracé', () => {
    let d = build([A, B], 'route');
    d = resolveSegment(d, 0, A, B, [A, B]);
    expect(setSegmentMode(d, 0, 'line').segments[0]).toEqual({ mode: 'line', coords: null });
    expect(setSegmentMode(d, 0, 'route')).toBe(d);
  });

  it('densifie les lignes droites à l’enregistrement', () => {
    const d = build([A, B]);
    const g = docGeometry(d, { densifyM: 50 })!;
    expect(g.coordinates.length).toBeGreaterThan(10);
    expect(lineLength(g.coordinates)).toBeCloseTo(lineLength([A, B]), 0);
  });

  it('relit une géométrie existante sans la déformer', () => {
    const coords = Array.from({ length: 400 }, (_, i) => [6.1 + i * 0.0005, 43.2 + Math.sin(i / 20) * 0.003, 100 + i] as [number, number, number]);
    const doc = docFromGeometry({ type: 'LineString', coordinates: coords }, 20);
    expect(doc.waypoints.length).toBeLessThanOrEqual(21);
    expect(doc.waypoints[0]).toEqual([coords[0][0], coords[0][1]]);
    expect(docGeometry(doc)!.coordinates).toEqual(coords);
    expect(pendingSegments(doc)).toEqual([]);
    const multi = docFromGeometry({ type: 'MultiLineString', coordinates: [coords.slice(0, 5), coords.slice(5, 10)] });
    expect(docGeometry(multi)!.coordinates).toHaveLength(10);
  });

  it('valide le document enregistré', () => {
    expect(parseStored({ waypoints: [A, B], modes: ['route'] })).toEqual({ waypoints: [A, B], modes: ['route'] });
    expect(parseStored({ waypoints: [A, B], modes: [] })).toBeNull();
    expect(parseStored({ waypoints: [A, B], modes: ['x'] })).toBeNull();
    expect(parseStored({ waypoints: [['a', 1], B], modes: ['line'] })).toBeNull();
    expect(docFromStored({ waypoints: [A, B], modes: ['route'] }).segments).toEqual([{ mode: 'route', coords: null }]);
  });
});

describe('historique annuler / rétablir', () => {
  it('annule et rétablit les gestes, pas les tracés calculés', () => {
    let s = initialState(emptyDoc(), 'line');
    s = editorReducer(s, { type: 'add', p: A });
    s = editorReducer(s, { type: 'add', p: B });
    s = editorReducer(s, { type: 'add', p: C });
    expect(s.present.waypoints).toHaveLength(3);
    s = editorReducer(s, { type: 'undo' });
    expect(s.present.waypoints).toHaveLength(2);
    s = editorReducer(s, { type: 'redo' });
    expect(s.present.waypoints).toHaveLength(3);
    s = editorReducer(s, { type: 'undo' });
    s = editorReducer(s, { type: 'add', p: D });
    expect(s.future).toHaveLength(0);
    expect(editorReducer(initialState(emptyDoc()), { type: 'undo' }).present.waypoints).toHaveLength(0);
  });

  it('un tracé calculé ne crée pas d’entrée d’historique', () => {
    let s = initialState(emptyDoc(), 'route');
    s = editorReducer(s, { type: 'add', p: A });
    s = editorReducer(s, { type: 'add', p: B });
    const before = s.past.length;
    s = editorReducer(s, { type: 'resolved', seg: 0, from: A, to: B, coords: [A, B] });
    expect(s.past).toHaveLength(before);
    expect(s.present.segments[0].coords).toEqual([A, B]);
  });

  it('un échec de routage bascule le segment en ligne droite', () => {
    let s = initialState(emptyDoc(), 'route');
    s = editorReducer(s, { type: 'add', p: A });
    s = editorReducer(s, { type: 'add', p: B });
    s = editorReducer(s, { type: 'routeFailed', seg: 0, from: A, to: B });
    expect(s.present.segments[0].mode).toBe('line');
  });

  it('mode des nouveaux segments, tout recaler', () => {
    let s = initialState(emptyDoc(), 'line');
    s = editorReducer(s, { type: 'add', p: A });
    s = editorReducer(s, { type: 'add', p: B });
    s = editorReducer(s, { type: 'allModes', mode: 'route' });
    expect(s.present.segments[0].mode).toBe('route');
    expect(s.newMode).toBe('route');
  });
});

describe('stats en direct', () => {
  it('calcule distance et dénivelé, signale les lignes droites sans altitude', () => {
    const ele = (lon: number, e: number) => [lon, 43.22, e] as [number, number, number];
    const d: EditorDoc = {
      waypoints: [A, B, C],
      segments: [
        { mode: 'route', coords: [ele(6.14, 100), ele(6.143, 130), ele(6.146, 160), ele(6.15, 200)] },
        { mode: 'line', coords: null },
      ],
    };
    const s = liveStats(d);
    expect(s.distanceM).toBeGreaterThan(1000);
    expect(s.gainM).toBeGreaterThan(20);
    expect(s.partial).toBe(true);
    expect(liveStats(emptyDoc()).distanceM).toBe(0);
  });
});

describe('BRouter', () => {
  it('construit l’URL avec le profil VTT', () => {
    const u = new URL(buildRouteUrl(A, B, 'http://brouter:17777'));
    expect(u.searchParams.get('profile')).toBe('mtb');
    expect(u.searchParams.get('lonlats')).toBe('6.14,43.22|6.15,43.22');
    expect(u.searchParams.get('format')).toBe('geojson');
  });

  it('lit la réponse GeoJSON avec altitude', () => {
    const json = { features: [{ geometry: { type: 'LineString', coordinates: [[6.14, 43.22, 120.5], [6.15, 43.22, 130]] } }] };
    expect(parseRoute(json)).toEqual([[6.14, 43.22, 120.5], [6.15, 43.22, 130]]);
    expect(() => parseRoute({ features: [] })).toThrow(RoutingError);
  });

  it('traduit les erreurs BRouter', async () => {
    const f = vi.fn().mockResolvedValue(new Response('from-position not mapped in existing datafile', { status: 400 }));
    await expect(routeBetween(A, B, f as unknown as typeof fetch)).rejects.toMatchObject({ status: 422, message: expect.stringContaining('not mapped') });
    const down = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(routeBetween(A, B, down as unknown as typeof fetch)).rejects.toMatchObject({ status: 503 });
  });
});
