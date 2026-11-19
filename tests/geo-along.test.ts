import { describe, expect, it } from 'vitest';
import { kmAlongTrack } from '@/lib/geo/along';
import { lineLength } from '@/lib/geo';
import type { Position } from '@/lib/geo/types';

// Straight line eastwards, one vertex every 0.01° (~0.76 km at 45° N).
const line: Position[] = Array.from({ length: 11 }, (_, i) => [6 + i * 0.01, 45]);
const km = (n: number) => lineLength(line.slice(0, n + 1)) / 1000;

describe('kmAlongTrack (#1535)', () => {
  it('donne le km au point le plus proche', () => {
    const r = kmAlongTrack(line, 6.025, 45.0001)!;
    expect(r.kms).toHaveLength(1);
    expect(r.kms[0]).toBeCloseTo(km(2) + (km(3) - km(2)) / 2, 1);
    expect(r.distM).toBeLessThan(20);
  });
  it('0 au départ, longueur totale à l’arrivée', () => {
    expect(kmAlongTrack(line, 6, 45)!.kms[0]).toBeCloseTo(0, 3);
    expect(kmAlongTrack(line, 6.1, 45)!.kms[0]).toBeCloseTo(km(10), 3);
  });
  it('aller-retour : deux passages', () => {
    const back = [...line, ...[...line].reverse().slice(1)];
    const r = kmAlongTrack(back, 6.03, 45)!;
    expect(r.kms).toHaveLength(2);
    expect(r.kms[0]).toBeCloseTo(km(3), 2);
    expect(r.kms[1]).toBeCloseTo(2 * km(10) - km(3), 2);
  });
  it('multi-segments : abscisse continue', () => {
    const r = kmAlongTrack({ type: 'MultiLineString', coordinates: [line.slice(0, 5), line.slice(5)] }, 6.07, 45)!;
    expect(r.kms).toHaveLength(1);
    expect(r.kms[0]).toBeGreaterThan(km(6));
  });
  it('recale sur la longueur réelle', () => {
    expect(kmAlongTrack(line, 6.1, 45, 20)!.kms[0]).toBeCloseTo(20, 3);
  });
  it('trace trop courte', () => {
    expect(kmAlongTrack([[6, 45]], 6, 45)).toBeNull();
  });
});
