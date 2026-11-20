import { describe, expect, it } from 'vitest';
import { floatingPadding, NO_PADDING, samePadding } from '@/lib/tracks/map-view';

describe('floatingPadding (#1689)', () => {
  it('no padding without an open panel', () => {
    expect(floatingPadding({ desktop: true, panelOpen: false, viewportHeight: 800 })).toEqual(NO_PADDING);
    expect(floatingPadding({ desktop: false, panelOpen: false, viewportHeight: 800, snap: 0.5 })).toEqual(NO_PADDING);
  });
  it('desktop: rail + panel + gap on the left', () => {
    expect(floatingPadding({ desktop: true, panelOpen: true, viewportHeight: 800 })).toEqual({ top: 0, right: 0, bottom: 0, left: 504 });
  });
  it('mobile: sheet height at the current detent', () => {
    const o = { desktop: false, panelOpen: true, viewportHeight: 800 };
    expect(floatingPadding({ ...o, snap: '148px' }).bottom).toBe(148);
    expect(floatingPadding({ ...o, snap: 0.5 }).bottom).toBe(400);
    expect(floatingPadding({ ...o, snap: null }).bottom).toBe(400);
  });
  it('mobile: top detent is capped so some map stays visible', () => {
    expect(floatingPadding({ desktop: false, panelOpen: true, viewportHeight: 800, snap: 0.92 }).bottom).toBe(480);
  });
  it('samePadding tolerates missing sides', () => {
    expect(samePadding({ bottom: 0 }, NO_PADDING)).toBe(true);
    expect(samePadding({ left: 504 }, NO_PADDING)).toBe(false);
  });
});
