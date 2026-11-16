import { describe, it, expect } from 'vitest';
import { formatDuration, formatElevation, formatKm, formatOutingDate } from '@/lib/format';

const NB = ' ';

describe('format (chiffres à la française)', () => {
  it('distance, D+, durée', () => {
    expect(formatKm(32.1)).toBe(`32,1${NB}km`);
    expect(formatKm(5)).toBe(`5,0${NB}km`);
    expect(formatElevation(662.4)).toBe(`662${NB}m${NB}D+`);
    expect(formatDuration(210)).toBe(`3${NB}h${NB}30`);
    expect(formatDuration(45)).toBe(`45${NB}min`);
    expect(formatDuration(120)).toBe(`2${NB}h`);
  });

  it('date de sortie (heure de Paris)', () => {
    expect(formatOutingDate(new Date('2026-11-15T07:00:00Z'))).toBe(`dim. 15 nov. · 8${NB}h${NB}00`);
  });
});

describe('format en anglais (#1401)', () => {
  it('point décimal, dénivelé « +350 m », date 24 h', () => {
    expect(formatKm(32.1, 'en')).toBe(`32.1${NB}km`);
    expect(formatElevation(1662.4, 'en')).toBe(`+1,662${NB}m`);
    expect(formatDuration(210, 'en')).toBe(`3${NB}h${NB}30${NB}min`);
    expect(formatOutingDate(new Date('2026-11-15T07:00:00Z'), 'en')).toBe('Sun 15 Nov · 08:00');
  });
});
