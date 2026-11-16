import { describe, it, expect } from 'vitest';
import { gradeAt, indexAtX, nearestProfileIndex } from '../src/lib/elevation';

describe('curseur du profil ↔ carte (#1391)', () => {
  const pts = [
    { distKm: 0, ele: 100, lon: 6.0, lat: 43.0 },
    { distKm: 1, ele: 150, lon: 6.01, lat: 43.0 },
    { distKm: 2, ele: 120, lon: 6.02, lat: 43.0 },
  ];
  it('indexAtX : x du profil → point le plus proche', () => {
    expect(indexAtX(pts, 0, 320)).toBe(0);
    expect(indexAtX(pts, 170, 320)).toBe(1);
    expect(indexAtX(pts, 999, 320)).toBe(2);
    expect(indexAtX([], 10, 320)).toBe(-1);
  });
  it('nearestProfileIndex : position survolée sur la carte → point du profil', () => {
    expect(nearestProfileIndex(pts, 6.0101, 43.0002)).toBe(1);
    expect(nearestProfileIndex(pts, 6.5, 43.0)).toBe(2);
    expect(nearestProfileIndex([], 6, 43)).toBe(-1);
  });
  it('gradeAt : pente de l’arête qui part du point (ou qui arrive au dernier)', () => {
    expect(gradeAt([5, -3], 0)).toBe(5);
    expect(gradeAt([5, -3], 1)).toBe(-3);
    expect(gradeAt([5, -3], 2)).toBe(-3);
    expect(gradeAt([], 0)).toBeNull();
  });
});
