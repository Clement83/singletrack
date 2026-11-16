import { describe, expect, it } from 'vitest';
import { huntingInfo, VAR_HUNTING_SEASONS, type HuntingSeason } from '../src/lib/hunting';

describe('chasse : saison du Var 2026-2027 (#1354)', () => {
  it('ouverture générale du 13 septembre 2026 au 28 février 2027', () => {
    expect(huntingInfo('2026-09-13')).toEqual({ kind: 'general', tone: 'caution', until: '2027-02-28' });
    expect(huntingInfo('2026-11-15').kind).toBe('general');
    expect(huntingInfo('2027-02-28').kind).toBe('general');
  });
  it('battues au sanglier en mars, puis fermeture', () => {
    expect(huntingInfo('2027-03-01')).toEqual({ kind: 'boarDrive', tone: 'caution', until: '2027-03-31' });
    expect(huntingInfo('2027-04-01')).toEqual({ kind: 'closed', tone: 'ok' });
    expect(huntingInfo('2027-05-31').kind).toBe('closed');
  });
  it('été : battues autorisées, préouverture, jour de suspension', () => {
    expect(huntingInfo('2026-07-10').kind).toBe('boarAuthorized');
    expect(huntingInfo('2026-08-15')).toEqual({ kind: 'boarDrive', tone: 'caution', until: '2026-09-11' });
    expect(huntingInfo('2026-09-12')).toEqual({ kind: 'suspended', tone: 'ok' });
  });
  it('hors des arrêtés connus : inconnu, jamais « pas de chasse »', () => {
    expect(huntingInfo('2026-05-31')).toEqual({ kind: 'unknown', tone: 'unknown' });
    expect(huntingInfo('2027-06-01')).toEqual({ kind: 'unknown', tone: 'unknown' });
  });
  it('configuration cohérente : périodes ordonnées, sans chevauchement, dans la saison', () => {
    for (const s of VAR_HUNTING_SEASONS) {
      expect(s.from < s.to).toBe(true);
      expect(s.sources.length).toBeGreaterThan(0);
      s.periods.forEach((p, i) => {
        expect(p.from <= p.to).toBe(true);
        expect(p.from >= s.from && p.to <= s.to).toBe(true);
        if (i > 0) expect(p.from > s.periods[i - 1].to).toBe(true);
      });
    }
  });
  it('accepte une autre configuration', () => {
    const custom: HuntingSeason[] = [{ from: '2030-01-01', to: '2030-12-31', periods: [], sources: ['x'] }];
    expect(huntingInfo('2030-06-01', custom).kind).toBe('closed');
  });
});
