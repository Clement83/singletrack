import { describe, expect, it } from 'vitest';
import { MAX_SELECTION, assignColors, parseSelection, serializeSelection, toggleSelection } from '@/lib/tracks/selection';

describe('sélection de traces (#1532)', () => {
  it('ajoute puis retire au second tap', () => {
    const a = toggleSelection([], 'a');
    expect(a).toEqual({ selection: ['a'], action: 'added' });
    const b = toggleSelection(a.selection, 'b');
    expect(b.selection).toEqual(['a', 'b']);
    expect(toggleSelection(b.selection, 'a')).toEqual({ selection: ['b'], action: 'removed' });
  });
  it('refuse au-delà du plafond', () => {
    const full = Array.from({ length: MAX_SELECTION }, (_, i) => `s${i}`);
    expect(toggleSelection(full, 'x')).toEqual({ selection: full, action: 'full' });
    expect(toggleSelection(full, 's0').action).toBe('removed');
  });
  it('ignore un slug vide', () => expect(toggleSelection(['a'], '').action).toBe('noop'));
  it('couleurs stables et distinctes', () => {
    const c1 = assignColors(['a', 'b', 'c']);
    expect(new Set(Object.values(c1)).size).toBe(3);
    const c2 = assignColors(['a', 'c', 'd'], c1);
    expect(c2.a).toBe(c1.a);
    expect(c2.c).toBe(c1.c);
    expect(c2.d).toBe(c1.b); // le numéro libéré est réutilisé
  });
  it('huit traces = huit couleurs distinctes', () => {
    const order = Array.from({ length: 8 }, (_, i) => `s${i}`);
    expect(new Set(Object.values(assignColors(order))).size).toBe(8);
  });
  it('URL : aller-retour, doublons, plafond, valeurs invalides', () => {
    expect(parseSelection('a,b,a,,c d,é')).toEqual(['a', 'b']);
    expect(parseSelection(null)).toEqual([]);
    expect(parseSelection(Array.from({ length: 20 }, (_, i) => `s${i}`).join(',')).length).toBe(MAX_SELECTION);
    expect(parseSelection(serializeSelection(['x', 'y']))).toEqual(['x', 'y']);
  });
});
