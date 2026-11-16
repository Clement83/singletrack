import { describe, expect, it } from 'vitest';
import { indexAtX } from '@/lib/elevation';

const pts = [0, 1, 2, 3, 4].map((d) => ({ distKm: d, ele: 100 + d }));

describe('indexAtX', () => {
  it('trouve le point le plus proche du doigt', () => {
    expect(indexAtX(pts, 0, 320)).toBe(0);
    expect(indexAtX(pts, 160, 320)).toBe(2);
    expect(indexAtX(pts, 320, 320)).toBe(4);
  });
  it('borne les positions hors du profil', () => {
    expect(indexAtX(pts, -50, 320)).toBe(0);
    expect(indexAtX(pts, 900, 320)).toBe(4);
  });
  it('gère un profil vide', () => {
    expect(indexAtX([], 10, 320)).toBe(-1);
  });
});
