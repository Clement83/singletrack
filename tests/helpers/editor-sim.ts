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
 * Simulateur d'éditeur (#1522) : même câblage que `track-editor.tsx` (reducer + fonctions de `gestures.ts`), sans
 * React ni carte. Routage simulé par les fixtures BRouter réelles (`tests/fixtures/brouter/segments.json`, enregistrées
 * par `scripts/editor-routing-check.ts --record`) ; une paire inconnue reçoit un tracé synthétique à 3 points.
 * Projection écran fictive : 5000 px par degré (≈ 14 m par pixel à Toulon, zoom 13).
 */
export type Fixture = {
  from: LonLat; to: LonLat; coordinates: Position[];
  alternatives: { coordinates: Position[]; deltaKm: number; quality: 'faster' | 'similar' | 'smoother' | string }[];
};

const loadFixtures = (): Fixture[] => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'brouter', 'segments.json'), 'utf8'));
export const FIXTURES = loadFixtures();
/** Waypoints (lon, lat) de la fixture `k` : `from` et `to` tels que posés par l'utilisateur. */
export const fx = (k: number) => FIXTURES[k];

const PX_PER_DEG = 5000;
export const project = (c: Position) => ({ x: c[0] * PX_PER_DEG, y: -c[1] * PX_PER_DEG });
export const unproject = (p: [number, number]) => ({ lng: p[0] / PX_PER_DEG, lat: -p[1] / PX_PER_DEG });
/** Décale un point de `px` pixels écran vers l'est. */
export const shiftPx = (p: LonLat, px: number): LonLat => [p[0] + px / PX_PER_DEG, p[1]];

const eq = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];

export class EditorSim {
  state: EditorState;
  altSets: AltSet[] = [];
  snapOn: boolean;
  tolPx: number;
  /** Élargit chaque glisser aux points posés à la main (#1641), comme le fera l'éditeur. */
  choice: boolean;
  rider = 'muscle' as const;
  singles: { coordinates: Position[] }[] = [];
  /** Appels de routage effectués (clé `from|to`), pour vérifier le cache. */
  calls: string[] = [];
  /** Temps simulé (ms) : avance de 1 s à chaque geste pour que le relâchement d'un glisser ne bloque pas le tap suivant. */
  private now = 10_000;
  private lastDrag = -Infinity;
  private cache = new Map<string, { coords: Position[]; alts: Fixture['alternatives'] }>();
  failFor = new Set<string>();
  private extra: Fixture[] = [];
  /** Impose le tracé BRouter d'un couple de points (cas que les fixtures n'ont pas). */
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
  /** Jeux d'alternatives encore valables, un par tronçon (#1527). */
  get altList() { return withoutChoiceAlts(liveAltSets(this.altSets, (i) => this.doc.segments[i]?.coords ?? undefined, this.rider), this.state.choice); }
  /** Dernier jeu valable (compatibilité des scénarios à un seul tronçon). */
  get alts() { return this.altList.at(-1) ?? null; }
  get geometry() { return docGeometry(this.doc); }
  dispatch = (a: EditorAction) => { this.state = editorReducer(this.state, a); };

  private env() { return { project, unproject, tolPx: this.tolPx }; }
  private snap = (p: LonLat, exclude: number[] = []) => (this.snapOn ? snapPointIn(p, this.doc, this.singles, this.env(), exclude) : null);

  private tick() { this.now += 1000; }

  /** Tap / clic carte avec les calques touchés. */
  click(p: LonLat, features: HitFeature[] = []) {
    this.tick();
    const d = decideClick({ features, p, selected: this.state.selected, lineMenuOpen: false, sinceDragMs: this.now - this.lastDrag, snap: (q) => this.snap(q) });
    if (d.kind === 'chooseAlt') this.chooseAlt(d.alt);
    else if (d.kind === 'restoreDeviation') this.dispatch({ type: 'restoreDeviation' });
    else if (d.kind === 'dispatch') this.dispatch(d.action);
    return d;
  }
  /** Tap sur la ligne (calque `edit-hit` du tronçon `seg`). */
  tapLine(seg: number, p: LonLat) { return this.click(p, [{ layer: 'edit-hit', props: { seg } }]); }
  tapAlt(alt: number, p: LonLat) { return this.click(p, [{ layer: 'alt-hit', props: { alt } }]); }
  tapDeviation(p: LonLat) { return this.click(p, [{ layer: 'dev-hit', props: {} }]); }
  /** Pose un point (tap sur la carte vide). */
  add(p: LonLat) { return this.click(p); }

  /** Glisser le point `i` jusqu'en `p`. */
  dragPoint(i: number, p: LonLat) {
    this.tick();
    this.lastDrag = this.now;
    this.dispatch(dragPointAction(i, p, this.snap(p, pointDragExclude(i))));
    this.widen();
  }
  /** Glisser la ligne du tronçon `seg` depuis `from` jusqu'en `to` (`moved` faux = simple clic, rien ne se passe). */
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
  /** Calcule les ancres lointaines puis ouvre la paire de choix (si le tracé rejoint l'ancien dans les plafonds). */
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

  /** Attend le routage : demande chaque tronçon en attente (cache par couple de points) jusqu'à stabilité. */
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
