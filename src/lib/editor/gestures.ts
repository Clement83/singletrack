import type { Position } from '@/lib/geo';
import type { EditorDoc, LonLat } from './doc';
import type { EditorAction } from './state';
import { makeAltSet, type AltSet } from './alts';
import { snapEndpoint, snapToGroups, type Px, type SnapGroup } from './snap';
import { segmentLine } from './doc';
import type { Quality } from '@/lib/routing/alternatives';

/**
 * Editor gestures (#1522): every decision (tap, drag, snapping after routing, alternatives) as pure
 * functions, without React or MapLibre. `track-editor.tsx` only calls them; the scenarios in `tests/`
 * replay them with simulated routing (BRouter fixtures) and a fake screen projection.
 */

/** Clickable layers of the map (`interactiveLayerIds`). */
export type HitLayer = 'alt-hit' | 'dev-hit' | 'edit-hit';
export type HitFeature = { layer: string; props: { seg?: number; alt?: number } };

/** Threshold (px) beyond which a press on the line becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** Releasing a drag must not be taken for a tap during this delay (ms). */
export const TAP_AFTER_DRAG_MS = 400;

export type ClickInput = {
  features: HitFeature[];
  p: LonLat;
  /** Selected point (popover) or `null`. */
  selected: number | null;
  lineMenuOpen: boolean;
  /** Time elapsed since the last drag (ms). */
  sinceDragMs: number;
  /** Snapped position of `p` (singletracks, current track) or `null`; only called when placing a point. */
  snap: (p: LonLat) => LonLat | null;
};

export type ClickDecision =
  | { kind: 'ignore' }
  | { kind: 'closeMenu' }
  | { kind: 'chooseAlt'; alt: number; seg: number }
  | { kind: 'restoreDeviation' }
  | { kind: 'dispatch'; action: EditorAction; vibrate?: boolean };

/** Tap / click on the map: pick an alternative, restore a detour, insert, deselect or add. */
export function decideClick(c: ClickInput): ClickDecision {
  if (c.sinceDragMs < TAP_AFTER_DRAG_MS) return { kind: 'ignore' };
  if (c.lineMenuOpen) return { kind: 'closeMenu' };
  const altHit = c.features.find((f) => f.layer === 'alt-hit');
  if (altHit) return { kind: 'chooseAlt', alt: Number(altHit.props.alt), seg: Number(altHit.props.seg) };
  if (c.features.some((f) => f.layer === 'dev-hit')) return { kind: 'restoreDeviation' };
  const hit = c.features.find((f) => f.layer === 'edit-hit');
  if (hit) return { kind: 'dispatch', action: { type: 'insert', seg: Number(hit.props.seg), p: c.p } };
  if (c.selected !== null) return { kind: 'dispatch', action: { type: 'select', i: null } };
  const snapped = c.snap(c.p);
  return { kind: 'dispatch', action: { type: 'add', p: snapped ?? c.p }, vibrate: !!snapped };
}

/** End of a point drag: detour, snapped outside the two neighbouring segments (`exclude` done by the caller). */
export const dragPointAction = (i: number, raw: LonLat, snap: LonLat | null): EditorAction => ({ type: 'deviate', i, p: snap ?? raw });

/** End of a line drag (segment `seg`): inserts a point and places it, in one gesture. */
export const dragLineAction = (seg: number, raw: LonLat, snap: LonLat | null): EditorAction => ({ type: 'deviate', seg, i: 0, p: snap ?? raw });

/** Segments to keep out of the magnet while dragging point `i` (its two neighbours). */
export const pointDragExclude = (i: number): number[] => [i - 1, i];

export type LineDrag = { seg: number; x: number; y: number; p: LonLat; moved: boolean };

/** Mouse move during a line drag. Releasing outside the map is handled by a `mouseup` on the window (#1525): `buttons` is no longer reliable (touchpad). */
export function moveLineDrag(d: LineDrag, pt: { x: number; y: number }, p: LonLat): LineDrag {
  return { ...d, p, moved: d.moved || Math.hypot(pt.x - d.x, pt.y - d.y) > DRAG_THRESHOLD_PX };
}

/** Release: the action to send if the line was really dragged (otherwise it is a simple click). */
export function endLineDrag(d: LineDrag, raw: LonLat, snap: (p: LonLat, exclude: number[]) => LonLat | null): EditorAction | null {
  return d.moved ? dragLineAction(d.seg, raw, snap(raw, [d.seg])) : null;
}

export type SnapEnv = { project: (c: Position) => Px; tolPx: number };

export type RoutedResult = {
  /** Actions to send to the reducer, in order (outside history). */
  actions: EditorAction[];
  /** End points after snapping. */
  from: LonLat;
  to: LonLat;
  /** Alternative set of the segment (`null` if there is none). */
  altSet: AltSet | null;
};

/**
 * Resolution of a routed segment: stores the line, snaps each end point onto the start/end of the line if the gap
 * is under the tolerance (BRouter magnet, #1437), then builds the alternative set, signed with the snapped points.
 * `snap` = `null` if the magnet is off or the map unavailable.
 */
export function resolveRouted(a: {
  doc: EditorDoc; rider: string; i: number; from: LonLat; to: LonLat; coords: Position[];
  alts: { coordinates: Position[]; deltaKm: number; quality: Quality }[];
  snap: SnapEnv | null;
  /** History length: groups the alternative sets of the same gesture (#1527). */
  gen?: number;
}): RoutedResult {
  const { rider, i, from, to, coords } = a;
  const actions: EditorAction[] = [{ type: 'resolved', seg: i, from, to, coords }];
  let f: LonLat = from;
  let t: LonLat = to;
  if (a.snap && coords.length >= 2) {
    const sf = snapEndpoint(from, coords[0], a.snap.project, a.snap.tolPx);
    const st = snapEndpoint(to, coords[coords.length - 1], a.snap.project, a.snap.tolPx);
    if (sf) actions.push({ type: 'snapEnd', i, from, p: sf });
    if (st) actions.push({ type: 'snapEnd', i: i + 1, from: to, p: st });
    f = sf ?? from;
    t = st ?? to;
  }
  // #1527: the set is valid as long as the segment's line is one of its own (see `liveAltSets`); snapping a neighbour no longer hides it.
  return { actions, from: f, to: t, altSet: makeAltSet(i, f, t, coords, a.alts, rider, a.gen) };
}

/** Choice of alternative `i` of set `alts`: action (in history) and new set, or `null` if it has no effect. */
export function chooseAltResult(alts: AltSet | null | undefined, i: number): { action: EditorAction; altSet: AltSet } | null {
  if (!alts || i === alts.active || !alts.routes[i]) return null;
  return {
    action: { type: 'chooseRoute', seg: alts.seg, from: alts.from, to: alts.to, coords: alts.routes[i] },
    altSet: { ...alts, active: i },
  };
}

export type MapEnv = { project: (c: Position) => Px; unproject: (p: [number, number]) => { lng: number; lat: number }; tolPx: number };

/** Snapped position of `p` (singletracks first, then the current track outside segments `exclude`), or `null` if free. */
export function snapPointIn(p: LonLat, doc: EditorDoc, singles: { coordinates: Position[] }[], env: MapEnv, exclude: number[] = []): LonLat | null {
  const at = env.project(p);
  const a = env.unproject([at.x - env.tolPx, at.y + env.tolPx]);
  const b = env.unproject([at.x + env.tolPx, at.y - env.tolPx]);
  const own = doc.segments.flatMap((_, i) => (exclude.includes(i) ? [] : [{ coordinates: segmentLine(doc, i) }]));
  const groups: SnapGroup[] = [{ id: 'singles', lines: singles }, { id: 'own', lines: own }];
  const box: [number, number, number, number] = [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)];
  // #1525: the closest target wins, not the priority group (otherwise a singletrack at 9 px beats a track at 2 px and the point is re-glued).
  let best: ReturnType<typeof snapToGroups> = null;
  for (const g of groups) {
    const h = snapToGroups(at, [g], env.project, env.tolPx, box);
    if (h && (!best || h.distPx < best.distPx)) best = h;
  }
  return best ? best.point : null;
}
