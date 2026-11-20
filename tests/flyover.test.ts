import { describe, expect, it } from 'vitest';
import {
  angleDiff, bearing, buildFlyPath, distanceOfProfileIndex, flyDurationMs, lookAheadHeading, lookAheadM,
  nextSpeed, positionAt, profileIndexAt, slopeZoomOffset, smoothHeading,
} from '@/lib/geo/flyover';
import type { TrackGeometry } from '@/lib/geo/types';

// ~1.11 km per 0.01° of latitude; straight line going north then east.
const L: TrackGeometry = { type: 'LineString', coordinates: [[6, 43], [6, 43.01], [6, 43.01], [6.014, 43.01]] };

describe('flyover path', () => {
  const p = buildFlyPath(L);
  it('drops duplicate points and accumulates distance', () => {
    expect(p.coords).toHaveLength(3);
    expect(p.cum[0]).toBe(0);
    expect(p.totalM).toBeGreaterThan(1900);
  });
  it('interpolates the position and clamps at the ends', () => {
    expect(positionAt(p, 0)).toEqual([6, 43]);
    expect(positionAt(p, -5)).toEqual([6, 43]);
    expect(positionAt(p, 1e9)).toEqual([6.014, 43.01]);
    const mid = positionAt(p, p.cum[1] / 2);
    expect(mid[0]).toBe(6);
    expect(mid[1]).toBeCloseTo(43.005, 4);
  });
});

describe('headings', () => {
  it('bearing: north, east, south, west', () => {
    expect(bearing([6, 43], [6, 44])).toBeCloseTo(0);
    expect(bearing([6, 43], [7, 43])).toBeCloseTo(90, 0);
    expect(bearing([6, 43], [6, 42])).toBeCloseTo(180);
    expect(bearing([6, 43], [5, 43])).toBeCloseTo(270, 0);
  });
  it('angleDiff takes the shortest way', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
  });
  it('look-ahead heading follows the next stretch, and the last stretch near the finish', () => {
    expect(lookAheadHeading(buildFlyPath(L), 0, 200)).toBeCloseTo(0, 0);
    const p = buildFlyPath(L);
    expect(lookAheadHeading(p, p.totalM, 200)).toBeCloseTo(90, 0);
    expect(lookAheadM(1000)).toBe(150);
    expect(lookAheadM(1e6)).toBe(300);
  });
  it('smoothHeading damps and caps the rotation (no jump on a U-turn)', () => {
    const h = smoothHeading(0, 180, 1 / 60);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(2);
    let cur = 0;
    for (let i = 0; i < 60; i++) cur = smoothHeading(cur, 180, 1 / 60);
    expect(cur).toBeLessThanOrEqual(40.01); // ≤ 40°/s
    expect(smoothHeading(350, 10, 0.1)).toBeGreaterThan(350); // crosses 0 without going the long way
  });
  it('smoothHeading converges', () => {
    let cur = 10;
    for (let i = 0; i < 600; i++) cur = smoothHeading(cur, 200, 1 / 60);
    expect(cur).toBeCloseTo(200, 0);
  });
});

describe('timing and profile', () => {
  it('about 60 s for 30 km at ×1, shorter at higher speeds, clamped', () => {
    expect(flyDurationMs(30_000)).toBe(60_000);
    expect(flyDurationMs(30_000, 4)).toBe(15_000);
    expect(flyDurationMs(100)).toBe(20_000);
    expect(flyDurationMs(1e6)).toBe(240_000);
  });
  it('speed cycles ×1 → ×2 → ×4 → ×1', () => {
    expect([nextSpeed(1), nextSpeed(2), nextSpeed(4)]).toEqual([2, 4, 1]);
  });
  const prof = [0, 1, 2, 3].map((distKm) => ({ distKm }));
  it('profile index at a distance and back', () => {
    expect(profileIndexAt(prof, 1500)).toBe(1);
    expect(profileIndexAt(prof, 99999)).toBe(3);
    expect(profileIndexAt([], 10)).toBe(-1);
    expect(distanceOfProfileIndex(prof, 2, 3000)).toBe(2000);
    expect(distanceOfProfileIndex(prof, 2, 6000)).toBe(4000);
  });
  it('zoom steps back only in steep slopes', () => {
    expect(slopeZoomOffset(5)).toBeCloseTo(0);
    expect(slopeZoomOffset(-20)).toBeCloseTo(-0.6);
  });
});
