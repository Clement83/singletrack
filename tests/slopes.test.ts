import { describe, it, expect } from 'vitest';
import { slopeClass, slopeSegments, kmMarkers, autoKmStep, edgeGrades, slopeCssColor, SLOPE_THRESHOLDS } from '../src/lib/geo/slopes';
import { lineLength } from '../src/lib/geo';
import type { Position, TrackGeometry } from '../src/lib/geo';

// ~1 m of latitude ≈ 9e-6 degrees; we go due north in steps of `stepM`.
const M = 1 / 111195;
function line(n: number, stepM: number, ele: (i: number) => number | undefined): Position[] {
  return Array.from({ length: n }, (_, i) => {
    const e = ele(i);
    return (e === undefined ? [6, 43 + i * stepM * M] : [6, 43 + i * stepM * M, e]) as Position;
  });
}
const ls = (c: Position[]): TrackGeometry => ({ type: 'LineString', coordinates: c });
const reverse = (g: TrackGeometry): TrackGeometry => ({ type: 'LineString', coordinates: [...(g as { coordinates: Position[] }).coordinates].reverse() });

describe('slopeClass', () => {
  it('classe montée et descente avec les mêmes seuils', () => {
    expect(SLOPE_THRESHOLDS).toEqual([3, 6, 9, 12]);
    expect(slopeClass(0.4).id).toBe('flat');
    expect(slopeClass(-0.9).token).toBeNull();
    expect(slopeClass(2).id).toBe('up-1');
    expect(slopeClass(3).id).toBe('up-2');
    expect(slopeClass(8.9).id).toBe('up-3');
    expect(slopeClass(11).id).toBe('up-4');
    expect(slopeClass(25).token).toBe('slope-up-5');
    expect(slopeClass(-2).id).toBe('down-1');
    expect(slopeClass(-13).token).toBe('slope-down-5');
  });
  it('couleur = variable de token, neutre pour plat', () => {
    expect(slopeCssColor(slopeClass(7))).toBe('var(--slope-up-3)');
    expect(slopeCssColor(slopeClass(0))).toBe('var(--muted-foreground)');
    expect(slopeCssColor(null)).toBe('var(--muted-foreground)');
  });
});

describe('slopeSegments', () => {
  it('montée régulière à ~10 % : un seul tronçon up-4', () => {
    const g = ls(line(30, 20, (i) => 100 + i * 2)); // 2 m par 20 m = 10 %
    const s = slopeSegments(g);
    expect(s).toHaveLength(1);
    expect(s[0].class.id).toBe('up-4');
    expect(s[0].grade).toBeCloseTo(10, 0);
    expect(s[0].fromKm).toBe(0);
    expect(s[0].toKm).toBeCloseTo(0.58, 1);
  });
  it('descente régulière à ~5 %', () => {
    const s = slopeSegments(ls(line(30, 20, (i) => 500 - i * 1)));
    expect(s.map((x) => x.class.id)).toEqual(['down-2']);
  });
  it('plat : un tronçon « plat » sans token', () => {
    const s = slopeSegments(ls(line(20, 20, () => 300)));
    expect(s).toHaveLength(1);
    expect(s[0].class.direction).toBe('flat');
  });
  it('bruit GPS ±2 m sur plat à 5 m de pas : pas de pentes absurdes', () => {
    const noise = [0, 2, -2, 1, -1, 2, -2, 0, 1, -2, 2, -1, 0, 2, -2, 1, -1, 2, -2, 0];
    const s = slopeSegments(ls(line(20, 5, (i) => 300 + noise[i])));
    const maxAbs = Math.max(...s.map((x) => Math.abs(x.grade)));
    expect(maxAbs).toBeLessThan(6);
    expect(edgeGrades([0, 5, 10, 15, 20, 25], [0, 5, 0, 5, 0, 5]).every((g) => Math.abs(g) < 30)).toBe(true);
  });
  it('profil montée puis descente : deux tronçons contigus, sens inversé = classes inversées', () => {
    const g = ls(line(41, 20, (i) => (i <= 20 ? 100 + i * 2 : 140 - (i - 20) * 2)));
    const fwd = slopeSegments(g).map((x) => x.class.id);
    expect(fwd[0]).toBe('up-4');
    expect(fwd[fwd.length - 1]).toBe('down-4');
    const back = slopeSegments(reverse(g)).map((x) => x.class.id);
    expect(back[0]).toBe('up-4');
    expect(back[back.length - 1]).toBe('down-4');
    // a pure climb becomes a pure descent
    const up = ls(line(30, 20, (i) => 100 + i * 2));
    expect(slopeSegments(reverse(up))[0].class.id).toBe('down-4');
  });
  it('tronçons contigus : la fin de l’un est le début du suivant', () => {
    const g = ls(line(41, 20, (i) => (i <= 20 ? 100 + i * 2 : 140 - (i - 20) * 2)));
    const s = slopeSegments(g);
    for (let i = 1; i < s.length; i++) expect(s[i].fromKm).toBeCloseTo(s[i - 1].toKm, 9);
  });
  it('sans altitude (ou altitude partielle) : aucun tronçon', () => {
    expect(slopeSegments(ls(line(10, 20, () => undefined)))).toEqual([]);
    expect(slopeSegments(ls(line(10, 20, (i) => (i === 4 ? undefined : 100))))).toEqual([]);
  });
  it('MultiLineString : kilométrage cumulé d’une ligne à l’autre', () => {
    const a = line(11, 20, (i) => 100 + i * 2);
    const b = line(11, 20, (i) => 140 + i * 2).map((p) => [p[0] + 0.01, p[1], p[2]] as Position);
    const s = slopeSegments({ type: 'MultiLineString', coordinates: [a, b] });
    expect(s).toHaveLength(2);
    expect(s[1].fromKm).toBeCloseTo(s[0].toKm, 6);
  });
});

describe('kmMarkers', () => {
  // 42.3 km due north: 423 steps of 100 m
  const long = ls(line(424, 100, () => undefined));
  it('42,3 km : 42 bornes au pas de 1 km, numérotées de 1 à 42', () => {
    expect(lineLength((long as { coordinates: Position[] }).coordinates)).toBeGreaterThan(42000);
    const m = kmMarkers(long, 1);
    expect(m).toHaveLength(42);
    expect(m[0].km).toBe(1);
    expect(m[41].km).toBe(42);
    expect(m[0].position[1]).toBeCloseTo(43 + 1000 * M, 4);
  });
  it('pas automatique : pas plus de 25 bornes', () => {
    expect(autoKmStep(12)).toBe(1);
    expect(autoKmStep(42.3)).toBe(2);
    expect(autoKmStep(120)).toBe(5);
    const m = kmMarkers(long);
    expect(m.length).toBeLessThanOrEqual(25);
    expect(m.map((x) => x.km).slice(0, 3)).toEqual([2, 4, 6]);
  });
  it('trace sans altitude et trace courte', () => {
    expect(kmMarkers(ls(line(5, 100, () => undefined)))).toEqual([]);
    expect(kmMarkers(ls(line(21, 100, () => undefined)))).toHaveLength(2);
  });
  it('MultiLineString : distance cumulée', () => {
    const a = line(8, 100, () => undefined); // 700 m
    const b = line(8, 100, () => undefined).map((p) => [p[0] + 0.01, p[1]] as Position); // 700 m
    const m = kmMarkers({ type: 'MultiLineString', coordinates: [a, b] }, 1);
    expect(m).toHaveLength(1);
    expect(m[0].position[0]).toBeCloseTo(6.01, 3); // the marker falls in the 2nd line
  });
});

describe('pastilles km selon le zoom (#1382)', () => {
  it('toutes de près, une sur 5 puis une sur 10 en dézoomant', async () => {
    const { kmStepForZoom, kmMarkers } = await import('../src/lib/geo/slopes');
    expect([14, 13, 12, 11, 10.5, 8].map(kmStepForZoom)).toEqual([1, 1, 5, 5, 10, 10]);
    // Straight track of about 42.3 km eastwards: markers 1 to 42.
    const lonPerKm = 1 / (111.32 * Math.cos((43.2 * Math.PI) / 180));
    const g = { type: 'LineString' as const, coordinates: [[6, 43.2], [6 + 42.3 * lonPerKm, 43.2]] as [number, number][] };
    const km = kmMarkers(g, 1).map((m) => m.km);
    expect(km[0]).toBe(1);
    expect(km.at(-1)).toBe(42);
    expect(km).toHaveLength(42);
  });
});
