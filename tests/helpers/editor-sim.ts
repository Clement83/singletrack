import fs from 'node:fs';
import path from 'node:path';
import type { Position } from '@/lib/geo';
import { docGeometry, emptyDoc, pendingSegments, type EditorDoc, type LonLat } from '@/lib/editor/doc';
import { editorReducer, initialState, type EditorAction, type EditorState } from '@/lib/editor/state';
import { buildWiden, planWiden, withoutChoiceAlts } from '@/lib/editor/choice';
import { liveAltSets, upsertAlt, type AltSet } from '@/lib/editor/alts';
import {
  chooseAltResult, decideClick, dragPointAction, endLineDrag, moveLineDrag, pointDragExclude, resolveRouted, snapPointIn, type HitFeature, type LineDrag,
} from '@/lib/editor/gestures';

/**
 * Editor simulator (#1522): same wiring as `track-editor.tsx` (reducer + functions from `gestures.ts`), without
 * React or a map. Routing simulated with the real BRouter fixtures (`tests/fixtures/brouter/segments.json`, recorded
 * by `scripts/editor-routing-check.ts --record`); an unknown pair gets a synthetic 3-point line.
 * Fake screen projection: 5000 px per degree (≈ 14 m per pixel at Toulon, zoom 13).
 */
export type Fixture = {
  from: LonLat; to: LonLat; coordinates: Position[];
  alternatives: { coordinates: Position[]; deltaKm: number; quality: 'faster' | 'similar' | 'smoother' | string }[];
};

const loadFixtures = (): Fixture[] => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'brouter', 'segments.json'), 'utf8'));
export const FIXTURES = loadFixtures();
/** Waypoints (lon, lat) of fixture `k`: `from` and `to` as placed by the user. */
export const fx = (k: number) => FIXTURES[k];

const PX_PER_DEG = 5000;
export const project = (c: Position) => ({ x: c[0] * PX_PER_DEG, y: -c[1] * PX_PER_DEG });
export const unproject = (p: [number, number]) => ({ lng: p[0] / PX_PER_DEG, lat: -p[1] / PX_PER_DEG });
/** Shifts a point `px` screen pixels eastwards. */
export const shiftPx = (p: LonLat, px: number): LonLat => [p[0] + px / PX_PER_DEG, p[1]];

const eq = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];

export class EditorSim {
  state: EditorState;
  altSets: AltSet[] = [];
  snapOn: boolean;
  tolPx: number;
  /** Widens every drag to hand-placed points (#1641), as the editor will. */
  choice: boolean;
  rider = 'muscle' as const;
  singles: { coordinates: Position[] }[] = [];
  /** Routing calls made (key `from|to`), to check the cache. */
  calls: string[] = [];
  /** Simulated time (ms): advances 1 s per gesture so that releasing a drag does not block the next tap. */
  private now = 10_000;
  private lastDrag = -Infinity;
  private cache = new Map<string, { coords: Position[]; alts: Fixture['alternatives'] }>();
  failFor = new Set<string>();
  private extra: Fixture[] = [];
  /** Forces the BRouter line of a pair of points (cases the fixtures do not have). */
  stub(from: LonLat, to: LonLat, coordinates: Position[], alternatives: Fixture['alternatives'] = []) {
    this.extra.unshift({ from, to, coordinates, alternatives });
  }

  constructor(opts: { doc?: EditorDoc; snap?: boolean; tolPx?: number; newMode?: 'route' | 'line'; choice?: boolean } = {}) {
    this.choice = opts.choice ?? false;
    this.state = initialState(opts.doc ?? emptyDoc(), opts.newMode ?? 'route');
    this.snapOn = opts.snap ?? false;
    this.tolPx = opts.tolPx ?? 24;
  }

  get doc() { return this.state.present; }
  get waypoints() { return this.doc.waypoints; }
  get segments() { return this.doc.segments; }
  /** Alternative sets still valid, one per segment (#1527). */
  get altList() { return withoutChoiceAlts(liveAltSets(this.altSets, (i) => this.doc.segments[i]?.coords ?? undefined, this.rider), this.state.choice); }
  /** Last valid set (compatibility with single-segment scenarios). */
  get alts() { return this.altList.at(-1) ?? null; }
  get geometry() { return docGeometry(this.doc); }
  dispatch = (a: EditorAction) => { this.state = editorReducer(this.state, a); };

  private env() { return { project, unproject, tolPx: this.tolPx }; }
  private snap = (p: LonLat, exclude: number[] = []) => (this.snapOn ? snapPointIn(p, this.doc, this.singles, this.env(), exclude) : null);

  private tick() { this.now += 1000; }

  /** Map tap / click with the layers hit. */
  click(p: LonLat, features: HitFeature[] = []) {
    this.tick();
    const d = decideClick({ features, p, selected: this.state.selected, lineMenuOpen: false, sinceDragMs: this.now - this.lastDrag, snap: (q) => this.snap(q) });
    if (d.kind === 'chooseAlt') this.chooseAlt(d.alt);
    else if (d.kind === 'restoreDeviation') this.dispatch({ type: 'restoreDeviation' });
    else if (d.kind === 'dispatch') this.dispatch(d.action);
    return d;
  }
  /** Tap on the line (`edit-hit` layer of segment `seg`). */
  tapLine(seg: number, p: LonLat) { return this.click(p, [{ layer: 'edit-hit', props: { seg } }]); }
  tapAlt(alt: number, p: LonLat) { return this.click(p, [{ layer: 'alt-hit', props: { alt } }]); }
  tapDeviation(p: LonLat) { return this.click(p, [{ layer: 'dev-hit', props: {} }]); }
  /** Places a point (tap on the empty map). */
  add(p: LonLat) { return this.click(p); }

  /** Drags point `i` to `p`. */
  dragPoint(i: number, p: LonLat) {
    this.tick();
    this.lastDrag = this.now;
    this.dispatch(dragPointAction(i, p, this.snap(p, pointDragExclude(i))));
    this.widen();
  }
  /** Drags the line of segment `seg` from `from` to `to` (`moved` false = simple click, nothing happens). */
  dragLine(seg: number, from: LonLat, to: LonLat, moved = true) {
    this.tick();
    const sp = project(from);
    const ep = project(to);
    let d: LineDrag | null = { seg, x: sp.x, y: sp.y, p: from, moved: false };
    d = moved ? moveLineDrag(d, ep, to) : d;
    const act = d && endLineDrag(d, to, (q, ex) => this.snap(q, ex));
    if (act) {
      this.lastDrag = this.now;
      this.dispatch(act);
      this.widen();
    }
  }
  /** Computes the far anchors then opens the choice pair (if the line rejoins the old one within the caps). */
  widen() {
    const pd = this.state.pending;
    if (!this.choice || !pd) return;
    const plan = planWiden(pd);
    if (!plan) return;
    const up = plan.up === null ? null : this.route(pd.base.waypoints[plan.up], pd.p)?.coords ?? null;
    const down = plan.down === null ? null : this.route(pd.p, pd.base.waypoints[plan.down])?.coords ?? null;
    const result = buildWiden(pd, plan, up, down);
    if (result) this.dispatch({ type: 'widen', result });
  }
  undo() { this.dispatch({ type: 'undo' }); }
  redo() { this.dispatch({ type: 'redo' }); }
  chooseAlt(i: number, seg?: number) {
    const cur = seg === undefined ? this.alts : this.altList.find((s) => s.seg === seg);
    const r = chooseAltResult(cur, i);
    if (!r) return;
    this.dispatch(r.action);
    this.altSets = upsertAlt(this.altSets, r.altSet.seg, r.altSet, r.altSet.gen);
  }

  private route(from: LonLat, to: LonLat): { coords: Position[]; alts: Fixture['alternatives'] } | null {
    const k = `${from}|${to}`;
    if (this.failFor.has(k)) return null;
    const f = [...this.extra, ...FIXTURES].find((x) => eq(x.from, from) && eq(x.to, to));
    if (f) return { coords: f.coordinates, alts: f.alternatives };
    return { coords: [from, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + 0.0005], to], alts: [] };
  }

  /** Waits for routing: requests every pending segment (cache per pair of points) until stable. */
  settle() {
    for (let guard = 0; guard < 50; guard++) {
      const pending = pendingSegments(this.doc);
      if (!pending.length) return;
      const before = this.doc;
      for (const i of pending) {
        const from = this.doc.waypoints[i];
        const to = this.doc.waypoints[i + 1];
        const k = `${this.rider}|${from}|${to}`;
        let hit = this.cache.get(k);
        if (!hit) {
          this.calls.push(k);
          const r = this.route(from, to);
          if (!r) {
            this.dispatch({ type: 'routeFailed', seg: i, from, to });
            continue;
          }
          hit = r;
          this.cache.set(k, r);
        }
        const m = this.snapOn ? { project, tolPx: this.tolPx } : null;
        const res = resolveRouted({ doc: this.doc, rider: this.rider, i, from, to, coords: hit.coords, alts: hit.alts as never, snap: m, gen: this.state.past.length });
        res.actions.forEach(this.dispatch);
        this.altSets = upsertAlt(this.altSets, i, res.altSet, this.state.past.length);
      }
      if (this.doc === before) return;
    }
    throw new Error('settle: le routage ne se stabilise pas');
  }
}
