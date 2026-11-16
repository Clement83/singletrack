import { describe, expect, it } from 'vitest';
import { fireTileLevel, huntingTileLevel, weatherLevel } from '@/lib/conditions';

describe('niveaux du bloc Conditions compact (#1454)', () => {
  it('météo : ton de la prévision, gris sans donnée', () => {
    expect(weatherLevel(undefined)).toBe('none');
    expect(weatherLevel({ kind: 'unavailable' } as never)).toBe('none');
    expect(weatherLevel({ kind: 'ok', tone: 'warn' } as never)).toBe('warn');
    expect(weatherLevel({ kind: 'ok', tone: 'danger' } as never)).toBe('danger');
  });
  it('incendie : 1-2 vert, 3 orange, 4 rouge, 5 noir, gris hors Var ou sans donnée', () => {
    const lv = (n: 1 | 2 | 3 | 4 | 5) => fireTileLevel({ fireInfo: { kind: 'ok', date: 'd', names: [], worst: n, massifs: [] } });
    expect([1, 2, 3, 4, 5].map((n) => lv(n as 1))).toEqual(['ok', 'ok', 'warn', 'danger', 'black']);
    expect(fireTileLevel({ fire: 3 })).toBe('warn');
    expect(fireTileLevel({ fireInfo: { kind: 'none', date: 'd', names: [] } })).toBe('ok');
    expect(fireTileLevel({ fireInfo: { kind: 'off_season', date: 'd', names: [] } })).toBe('none');
    expect(fireTileLevel({ fire: 5, outsideVar: true })).toBe('none');
    expect(fireTileLevel({})).toBe('none');
  });
  it('chasse : vert pas de chasse, orange jour de chasse, gris inconnu', () => {
    expect(huntingTileLevel({ kind: 'closed', tone: 'ok' })).toBe('ok');
    expect(huntingTileLevel({ kind: 'general', tone: 'caution', until: '2027-02-28' })).toBe('warn');
    expect(huntingTileLevel({ kind: 'unknown', tone: 'unknown' })).toBe('none');
    expect(huntingTileLevel(undefined)).toBe('none');
    expect(huntingTileLevel({ kind: 'closed', tone: 'ok' }, true)).toBe('none');
  });
});
