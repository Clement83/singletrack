import { describe, it, expect } from 'vitest';
import { formatOutingDate } from '@/lib/format';
import { outingStatsLine, outingPeopleLine, clusterTipLines, type TipOuting } from '@/lib/outings/map-tip';

const base: TipOuting = { title: 'Boucle du Mourre', startsAt: new Date('2026-12-05T08:30:00Z'), yesCount: 3, spotsLeft: null, distanceM: 12400, gainM: 350 };
const fakeT = (key: 'going' | 'spots', v: { n: number }) => `${key}:${v.n}`;

describe('infobulle des sorties sur la carte (#1538)', () => {
  it('affiche km et D+ quand le D+ est connu', () => {
    expect(outingStatsLine(base, 'fr')).toMatch(/^12,4 km · 350 m D\+$/);
  });

  it("omet le D+ quand il est inconnu", () => {
    expect(outingStatsLine({ ...base, gainM: null }, 'fr')).toBe('12,4 km');
  });

  it('participants sans places restantes pour une sortie non limitée', () => {
    expect(outingPeopleLine(base, fakeT)).toBe('going:3');
  });

  it('ajoute les places restantes pour une sortie limitée', () => {
    expect(outingPeopleLine({ ...base, spotsLeft: 2 }, fakeT)).toBe('going:3 · spots:2');
  });

  it('grappe : une ligne par sortie, au plus 5', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...base, title: `S${i}` }));
    const lines = clusterTipLines(many, 'fr');
    expect(lines).toHaveLength(5);
    expect(lines[0].title).toBe('S0');
    expect(lines[0].date).toBe(formatOutingDate(new Date(base.startsAt), 'fr'));
    expect(lines[0].date).toMatch(/9.h.30/); // 08:30 UTC = 09:30 à Paris en décembre (format fr : « 9 h 30 »)
  });
});
