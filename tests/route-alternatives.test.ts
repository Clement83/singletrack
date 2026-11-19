import { describe, it, expect } from 'vitest';
import { describeAlternative, pickAlternatives, sharedShare } from '@/lib/routing/alternatives';
import { liveAltSets, liveAlts, makeAltSet, nextAlt, upsertAlt } from '@/lib/editor/alts';
import { editorReducer, initialState } from '@/lib/editor/state';
import { emptyDoc, type LonLat } from '@/lib/editor/doc';
import { shortcutFor } from '@/lib/editor/shortcuts';
import type { Position } from '@/lib/geo';
import type { RouteScore } from '@/lib/routing/score';

const sc = (km: number, gainM: number | null, effortKm: number): RouteScore => ({ km, gainM, lossM: gainM, effortKm, score: km + effortKm });
// West→east line at latitude `lat` (≈ 1.1 km long)
const line = (lat: number): Position[] => Array.from({ length: 11 }, (_, i) => [6.14 + i * 0.001, lat] as Position);

describe('étiquettes des alternatives (#1386)', () => {
  const best = sc(10, 300, 2);
  it('« plus doux » : moins de D+ ou d’effort, avec l’écart de distance arrondi', () => {
    expect(describeAlternative(best, sc(15.04, 200, 1))).toEqual({ deltaKm: 5, quality: 'gentler' });
    expect(describeAlternative(best, sc(10.34, 250, 2))).toEqual({ deltaKm: 0.3, quality: 'gentler' });
  });
  it('« plus raide » : plus de D+ ou d’effort', () => {
    expect(describeAlternative(best, sc(7, 400, 3))).toEqual({ deltaKm: -3, quality: 'steeper' });
  });
  it('« plus court » / « plus long » quand le relief est équivalent', () => {
    expect(describeAlternative(best, sc(9, 305, 2)).quality).toBe('shorter');
    expect(describeAlternative(best, sc(11, 300, 2)).quality).toBe('longer');
  });
  it('sans altitude : on juge sur la distance', () => {
    expect(describeAlternative(sc(10, null, 0), sc(12, null, 0))).toEqual({ deltaKm: 2, quality: 'longer' });
  });
});

describe('dédoublonnage', () => {
  it('part commune : identique = 1, éloigné = 0', () => {
    expect(sharedShare(line(43.2), line(43.2))).toBe(1);
    expect(sharedShare(line(43.2), line(43.21))).toBe(0);
  });
  it('écarte les candidats trop proches du recommandé et garde au plus 2 alternatives', () => {
    const best = { coordinates: line(43.2), score: sc(10, 300, 2) };
    const dup = { coordinates: line(43.2), score: sc(10.1, 300, 2) };
    const a = { coordinates: line(43.21), score: sc(12, 200, 1) };
    const b = { coordinates: line(43.22), score: sc(9, 400, 3) };
    const c = { coordinates: line(43.23), score: sc(11, 300, 2) };
    const picked = pickAlternatives(best, [best, dup, a, b, c]);
    expect(picked).toHaveLength(2);
    expect(picked.every((p) => p !== dup)).toBe(true);
  });
  it('deux alternatives identiques entre elles : une seule gardée', () => {
    const best = { coordinates: line(43.2), score: sc(10, 300, 2) };
    const a = { coordinates: line(43.21), score: sc(12, 200, 1) };
    const a2 = { coordinates: line(43.21), score: sc(12.5, 200, 1.5) };
    expect(pickAlternatives(best, [a, a2])).toHaveLength(1);
  });
});

describe('choix d’une alternative dans l’éditeur', () => {
  const A: LonLat = [6.14, 43.22];
  const B: LonLat = [6.15, 43.22];
  const best: Position[] = [A, B];
  const alt: Position[] = [A, [6.145, 43.225], B];
  const setup = () => {
    let s = initialState(emptyDoc(), 'route');
    s = editorReducer(s, { type: 'add', p: A });
    s = editorReducer(s, { type: 'add', p: B });
    return editorReducer(s, { type: 'resolved', seg: 0, from: A, to: B, coords: best });
  };
  it('entre dans l’historique : annuler revient au recommandé', () => {
    let s = setup();
    const n = s.past.length;
    s = editorReducer(s, { type: 'chooseRoute', seg: 0, from: A, to: B, coords: alt });
    expect(s.past).toHaveLength(n + 1);
    expect(s.present.segments[0].coords).toBe(alt);
    s = editorReducer(s, { type: 'undo' });
    expect(s.present.waypoints).toHaveLength(2);
  });
  it('ignoré si les extrémités ont changé', () => {
    const s = setup();
    expect(editorReducer(s, { type: 'chooseRoute', seg: 0, from: [0, 0], to: B, coords: alt })).toBe(s);
  });
  it('le jeu d’alternatives suit le geste : visible tant que la signature et le tracé correspondent', () => {
    const set = makeAltSet(0, A, B, best, [{ coordinates: alt, deltaKm: 1.2, quality: 'gentler' }], 'muscle')!;
    expect(set.routes).toHaveLength(2);
    expect(nextAlt(set)).toBe(1);
    expect(nextAlt({ ...set, active: 1 })).toBe(0);
    expect(liveAlts(set, 'muscle', best)).toBe(set);
    expect(liveAlts(set, 'ebike', best)).toBeNull();
    expect(liveAltSets([set], () => best, 'muscle')).toEqual([set]);
    expect(liveAltSets([set], () => alt, 'muscle')[0].active).toBe(1);
    expect(liveAltSets([set], () => [[9, 9]], 'muscle')).toEqual([]);
    const other = { ...set, seg: 1 };
    expect(upsertAlt([set, other], 1, null, 0)).toEqual([]); // next gesture (another generation)
    expect(liveAlts(set, set.sig, alt)).toBeNull(); // the segment's line changed (undo, etc.)
  });
  it('sans alternative : rien à proposer', () => {
    expect(makeAltSet(0, A, B, best, [], 'x')).toBeNull();
  });
  it('raccourci A', () => {
    expect(shortcutFor({ key: 'a' })).toBe('altRoute');
    expect(shortcutFor({ key: 'a' }, true)).toBeNull();
  });
});
