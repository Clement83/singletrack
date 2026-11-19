import { describe, it, expect } from 'vitest';
import { groupSameStart, tracksAtStart, SAME_START_M } from '@/lib/tracks/same-start';

const t = (slug: string, lon: number, lat: number) => ({ slug, start: [lon, lat] as [number, number] });
// ~0.00001° of latitude ≈ 1.1 m
const parking = [t('a', 6.1, 43.2), t('b', 6.1, 43.20001), t('c', 6.1006, 43.2)];
const far = t('z', 6.5, 43.4);

describe('même départ (#1531)', () => {
  it('tracksAtStart : ne garde que les départs à quelques mètres, le plus proche d’abord', () => {
    const r = tracksAtStart([...parking, far], [6.1, 43.2]);
    expect(r.map((x) => x.slug)).toEqual(['a', 'b']);
    expect(SAME_START_M).toBeGreaterThan(10);
  });
  it('tracksAtStart : rien près d’un point vide', () => {
    expect(tracksAtStart([far], [6.1, 43.2])).toEqual([]);
  });
  it('groupSameStart : regroupe le parking commun, isole les autres, par chaînage', () => {
    const g = groupSameStart([...parking, far]);
    expect(g.map((x) => x.map((y) => y.slug))).toEqual([['a', 'b'], ['c'], ['z']]);
    const chain = groupSameStart([t('1', 6, 43), t('2', 6, 43.0002), t('3', 6, 43.0004)], 25);
    expect(chain).toHaveLength(1);
  });
  it('groupSameStart : liste vide', () => {
    expect(groupSameStart([])).toEqual([]);
  });
});
