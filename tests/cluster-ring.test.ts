import { describe, expect, it } from 'vitest';
import { CLUSTER_PROPERTIES, clusterSize, countLabel, countsOf, ringArcs, totalOf } from '@/lib/tracks/cluster-ring';

describe('cluster ring (#1688)', () => {
  it('declares one counter per difficulty', () => {
    expect(Object.keys(CLUSTER_PROPERTIES).sort()).toEqual(['n_black', 'n_blue', 'n_green', 'n_none', 'n_red']);
  });
  it('reads counters defensively', () => {
    const c = countsOf({ n_green: 5, n_blue: '4', n_red: -1, n_black: 'x' });
    expect(c).toEqual({ green: 5, blue: 4, red: 0, black: 0, none: 0 });
    expect(totalOf(c)).toBe(9);
    expect(totalOf(countsOf(null))).toBe(0);
  });
  it('gives no arc without data and one arc per non-empty difficulty', () => {
    expect(ringArcs(countsOf({}), 40, 5)).toEqual([]);
    const arcs = ringArcs(countsOf({ n_green: 5, n_blue: 4, n_red: 3 }), 40, 5);
    expect(arcs.map((a) => a.key)).toEqual(['green', 'blue', 'red']);
    expect(arcs.every((a) => a.d.startsWith('M') && !a.d.includes('NaN'))).toBe(true);
  });
  it('draws a full ring for a single difficulty', () => {
    const [a] = ringArcs(countsOf({ n_red: 7 }), 40, 5);
    expect(a.key).toBe('red');
    expect(a.d.match(/M/g)).toHaveLength(2);
  });
  it('grows moderately with the count', () => {
    expect(clusterSize(2)).toBeLessThan(clusterSize(50));
    expect(clusterSize(100000)).toBeLessThanOrEqual(56);
    expect(clusterSize(1)).toBeGreaterThanOrEqual(36);
  });
  it('formats large counts', () => {
    expect(countLabel(42)).toBe('42');
    expect(countLabel(1234)).toBe('1.2k');
  });
});
