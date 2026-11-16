import { describe, it, expect } from 'vitest';
import { addWaypoint, emptyDoc } from '@/lib/editor/doc';
import { editorReducer, initialState } from '@/lib/editor/state';

describe('glisser un point ne le sélectionne pas (#1465)', () => {
  it('deviate et move laissent la sélection vide', () => {
    let d = addWaypoint(addWaypoint(emptyDoc(), [6.0, 43.0], 'line'), [6.01, 43.0], 'line');
    d = addWaypoint(d, [6.02, 43.0], 'line');
    let s = { ...initialState(d) };
    s = editorReducer(s, { type: 'deviate', i: 1, p: [6.01, 43.001] });
    expect(s.selected).toBeNull();
    s = editorReducer(s, { type: 'move', i: 1, p: [6.01, 43.002] });
    expect(s.selected).toBeNull();
  });
  it('select explicite reste possible', () => {
    const d = addWaypoint(emptyDoc(), [6, 43], 'line');
    expect(editorReducer(initialState(d), { type: 'select', i: 0 }).selected).toBe(0);
  });
});
