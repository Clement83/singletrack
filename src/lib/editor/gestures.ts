import type { Position } from '@/lib/geo';
import type { EditorDoc, LonLat } from './doc';
import type { EditorAction } from './state';
import { makeAltSet, type AltSet } from './alts';
import { snapEndpoint, snapToGroups, type Px, type SnapGroup } from './snap';
import { segmentLine } from './doc';
import type { Quality } from '@/lib/routing/alternatives';

/**
 * Gestes de l'éditeur (#1522) : toute la décision (tap, glisser, calage après routage, alternatives) en fonctions
 * pures, sans React ni MapLibre. `track-editor.tsx` se contente de les appeler ; les scénarios de `tests/` les
 * rejouent avec un routage simulé (fixtures BRouter) et une projection écran fictive.
 */

/** Calques cliquables de la carte (`interactiveLayerIds`). */
export type HitLayer = 'alt-hit' | 'dev-hit' | 'edit-hit';
export type HitFeature = { layer: string; props: { seg?: number; alt?: number } };

/** Seuil (px) au-delà duquel un appui sur la ligne devient un glisser. */
export const DRAG_THRESHOLD_PX = 4;
/** Le relâchement d'un glisser ne doit pas être pris pour un tap pendant ce délai (ms). */
export const TAP_AFTER_DRAG_MS = 400;

export type ClickInput = {
  features: HitFeature[];
  p: LonLat;
  /** Point sélectionné (popover) ou `null`. */
  selected: number | null;
  lineMenuOpen: boolean;
  /** Temps écoulé depuis le dernier glisser (ms). */
  sinceDragMs: number;
  /** Position aimantée de `p` (singles, trace en cours) ou `null` ; appelée seulement si on pose un point. */
  snap: (p: LonLat) => LonLat | null;
};

export type ClickDecision =
  | { kind: 'ignore' }
  | { kind: 'closeMenu' }
  | { kind: 'chooseAlt'; alt: number; seg: number }
  | { kind: 'restoreDeviation' }
  | { kind: 'dispatch'; action: EditorAction; vibrate?: boolean };

/** Tap / clic sur la carte : choisir une alternative, rétablir une déviation, insérer, désélectionner ou ajouter. */
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

/** Fin du glisser d'un point : déviation, aimantée hors des deux tronçons voisins (`exclude` fait par l'appelant). */
export const dragPointAction = (i: number, raw: LonLat, snap: LonLat | null): EditorAction => ({ type: 'deviate', i, p: snap ?? raw });

/** Fin du glisser de la ligne (tronçon `seg`) : insère un point et le place, en un geste. */
export const dragLineAction = (seg: number, raw: LonLat, snap: LonLat | null): EditorAction => ({ type: 'deviate', seg, i: 0, p: snap ?? raw });

/** Tronçons à écarter de l'aimant pendant le glisser du point `i` (ses deux voisins). */
export const pointDragExclude = (i: number): number[] => [i - 1, i];

export type LineDrag = { seg: number; x: number; y: number; p: LonLat; moved: boolean };

/** Déplacement de la souris pendant un glisser de ligne. Le relâcher hors carte est géré par un `mouseup` sur la fenêtre (#1525) : `buttons` n'est plus fiable (pavé tactile). */
export function moveLineDrag(d: LineDrag, pt: { x: number; y: number }, p: LonLat): LineDrag {
  return { ...d, p, moved: d.moved || Math.hypot(pt.x - d.x, pt.y - d.y) > DRAG_THRESHOLD_PX };
}

/** Relâchement : l'action à envoyer si la ligne a vraiment été tirée (sinon c'est un simple clic). */
export function endLineDrag(d: LineDrag, raw: LonLat, snap: (p: LonLat, exclude: number[]) => LonLat | null): EditorAction | null {
  return d.moved ? dragLineAction(d.seg, raw, snap(raw, [d.seg])) : null;
}

export type SnapEnv = { project: (c: Position) => Px; tolPx: number };

export type RoutedResult = {
  /** Actions à envoyer au reducer, dans l'ordre (hors historique). */
  actions: EditorAction[];
  /** Extrémités après calage. */
  from: LonLat;
  to: LonLat;
  /** Jeu d'alternatives du tronçon (`null` s'il n'y en a pas). */
  altSet: AltSet | null;
};

/**
 * Résolution d'un tronçon routé : enregistre le tracé, cale chaque extrémité sur le début/la fin du tracé si l'écart
 * est sous la tolérance (aimant BRouter, #1437), puis construit le jeu d'alternatives, signé avec les points calés.
 * `snap` = `null` si l'aimant est coupé ou la carte indisponible.
 */
export function resolveRouted(a: {
  doc: EditorDoc; rider: string; i: number; from: LonLat; to: LonLat; coords: Position[];
  alts: { coordinates: Position[]; deltaKm: number; quality: Quality }[];
  snap: SnapEnv | null;
  /** Longueur de l'historique : regroupe les jeux d'alternatives d'un même geste (#1527). */
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
  // #1527 : le jeu vaut tant que le tracé du tronçon est l'un des siens (voir `liveAltSets`) ; le calage d'un voisin ne le masque plus.
  return { actions, from: f, to: t, altSet: makeAltSet(i, f, t, coords, a.alts, rider, a.gen) };
}

/** Choix de l'alternative `i` du jeu `alts` : action (dans l'historique) et nouveau jeu, ou `null` si sans effet. */
export function chooseAltResult(alts: AltSet | null | undefined, i: number): { action: EditorAction; altSet: AltSet } | null {
  if (!alts || i === alts.active || !alts.routes[i]) return null;
  return {
    action: { type: 'chooseRoute', seg: alts.seg, from: alts.from, to: alts.to, coords: alts.routes[i] },
    altSet: { ...alts, active: i },
  };
}

export type MapEnv = { project: (c: Position) => Px; unproject: (p: [number, number]) => { lng: number; lat: number }; tolPx: number };

/** Position aimantée de `p` (singles d'abord, puis la trace en cours hors tronçons `exclude`), ou `null` si libre. */
export function snapPointIn(p: LonLat, doc: EditorDoc, singles: { coordinates: Position[] }[], env: MapEnv, exclude: number[] = []): LonLat | null {
  const at = env.project(p);
  const a = env.unproject([at.x - env.tolPx, at.y + env.tolPx]);
  const b = env.unproject([at.x + env.tolPx, at.y - env.tolPx]);
  const own = doc.segments.flatMap((_, i) => (exclude.includes(i) ? [] : [{ coordinates: segmentLine(doc, i) }]));
  const groups: SnapGroup[] = [{ id: 'singles', lines: singles }, { id: 'own', lines: own }];
  const box: [number, number, number, number] = [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)];
  // #1525 : la cible la plus proche gagne, pas le groupe prioritaire (sinon un single à 9 px bat une trace à 2 px et le point est recollé).
  let best: ReturnType<typeof snapToGroups> = null;
  for (const g of groups) {
    const h = snapToGroups(at, [g], env.project, env.tolPx, box);
    if (h && (!best || h.distPx < best.distPx)) best = h;
  }
  return best ? best.point : null;
}
