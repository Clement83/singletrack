import { describe, expect, it } from 'vitest';
import { snapView } from '@/components/tracks/singles-layer';

describe('snapView (#1436)', () => {
  it('un petit déplacement retombe sur la même clé de cache', () => {
    const a = snapView([6.1401, 43.2201, 6.2003, 43.2605], 12);
    const b = snapView([6.1432, 43.2230, 6.1999, 43.2590], 12);
    expect(a.key).toBe(b.key);
  });
  it('couvre toute la vue et change de clé selon le zoom', () => {
    const v: [number, number, number, number] = [6.14, 43.22, 6.2, 43.26];
    const s = snapView(v, 13);
    expect(s.bbox[0]).toBeLessThanOrEqual(v[0]);
    expect(s.bbox[3]).toBeGreaterThanOrEqual(v[3]);
    expect(snapView(v, 11).key).not.toBe(snapView(v, 13).key);
  });
});
