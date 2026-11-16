import { describe, expect, it } from 'vitest';
import { fillElevation } from '@/lib/geo';
import { liveStats } from '@/lib/editor/stats';

describe('fillElevation (#1467)', () => {
  it('interpole entre les points connus selon la distance', () => {
    const r = fillElevation([[6, 43, 100], [6.001, 43], [6.002, 43, 200]])!;
    expect(r.estimated).toEqual([false, true, false]);
    expect(r.eles[1]).toBeCloseTo(150, 0);
  });
  it('extrapole en constant aux extrémités', () => {
    const r = fillElevation([[6, 43], [6.001, 43, 120], [6.002, 43]])!;
    expect(r.eles).toEqual([120, 120, 120]);
    expect(r.estimated).toEqual([true, false, true]);
  });
  it('renvoie null sans aucune altitude', () => {
    expect(fillElevation([[6, 43], [6.001, 43]])).toBeNull();
  });
  it('liveStats garde un profil complet avec points estimés', () => {
    const doc = {
      waypoints: [[6, 43], [6.001, 43], [6.002, 43]],
      segments: [
        { mode: 'route', coords: [[6, 43, 100], [6.001, 43, 110]] },
        { mode: 'line', coords: null },
      ],
    } as never;
    const s = liveStats(doc);
    expect(s.profile.length).toBe(3);
    expect(s.profile.some((p) => p.estimated)).toBe(true);
  });
});
