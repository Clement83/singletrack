import { describe, it, expect } from 'vitest';
import { slopeFeatures, slopeFeaturesForRuns, slopeColorOf, slopeMatchExpression } from '../src/lib/geo/slope-features';
import type { Position, TrackGeometry } from '../src/lib/geo';

const M = 1 / 111195;
const line = (n: number, ele: (i: number) => number | undefined): Position[] =>
  Array.from({ length: n }, (_, i) => (ele(i) === undefined ? [6, 43 + i * 20 * M] : [6, 43 + i * 20 * M, ele(i) as number]) as Position);
const ls = (c: Position[]): TrackGeometry => ({ type: 'LineString', coordinates: c });
const ids = (g: TrackGeometry) => slopeFeatures(g).features.map((f) => f.properties.cls);

describe('slopeFeatures', () => {
  it('monte puis redescend : classes montée puis descente', () => {
    const up = ids(ls(line(30, (i) => i * 2))); // 10 %
    expect(up.every((c) => c.startsWith('up-'))).toBe(true);
    expect(ids(ls(line(30, (i) => 100 - i * 2))).every((c) => c.startsWith('down-'))).toBe(true);
  });
  it("inverser le sens inverse montée et descente", () => {
    const g = ls(line(30, (i) => i * 2));
    const r = ls([...line(30, (i) => i * 2)].reverse());
    expect(ids(g)[0]).toMatch(/^up-/);
    expect(ids(r)[0]).toMatch(/^down-/);
  });
  it('sans altitude : une ligne neutre', () => {
    expect(ids(ls(line(10, () => undefined)))).toEqual(['none']);
  });
});

describe('slopeFeaturesForRuns', () => {
  it('colore les segments chemins avec altitude, neutralise les autres, ignore les lignes droites', () => {
    const a = line(20, (i) => i * 2);
    const b = line(5, () => undefined);
    const c = [[6, 44]] as Position[];
    const f = slopeFeaturesForRuns([
      { coords: a, route: true },
      { coords: b, route: true },
      { coords: c.concat(c), route: false },
    ]).features.map((x) => x.properties.cls);
    expect(f[0]).toMatch(/^up-/);
    expect(f[f.length - 1]).toBe('none');
    expect(f.filter((x) => x === 'none')).toHaveLength(1); // the straight line adds nothing
  });
});

describe('couleurs', () => {
  const colors = { 'slope-up-1': '#111', 'slope-down-5': '#222' };
  it('sélectionne la couleur par classe', () => {
    expect(slopeColorOf('up-1', colors, 'F', 'N')).toBe('#111');
    expect(slopeColorOf('down-5', colors, 'F', 'N')).toBe('#222');
    expect(slopeColorOf('flat', colors, 'F', 'N')).toBe('F');
    expect(slopeColorOf('none', colors, 'F', 'N')).toBe('N');
  });
  it('expression match avec repli neutre', () => {
    const e = slopeMatchExpression(colors, 'F', 'N');
    expect(e.slice(0, 2)).toEqual(['match', ['get', 'cls']]);
    expect(e[e.length - 1]).toBe('N');
  });
});
