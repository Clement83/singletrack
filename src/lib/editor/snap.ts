import type { Position } from '@/lib/geo';
import type { LonLat } from './doc';

/**
 * Aimant de l'éditeur (#1437) : un point posé près d'un single ou de la trace en cours s'y accroche.
 * Logique pure : la projection écran est injectée (`project`/`unproject` de MapLibre), donc la tolérance est
 * en **pixels écran** (un doigt est imprécis, quel que soit le zoom).
 */

/** Tolérance au doigt et à la souris (px écran), décision de Clément (#1437). */
export const SNAP_TOLERANCE_TOUCH_PX = 24;
export const SNAP_TOLERANCE_MOUSE_PX = 10;

export type Px = { x: number; y: number };
export type SnapLine = { coordinates: Position[] };
/** Groupes par priorité décroissante (singles, puis trace en cours) : le premier groupe à portée gagne. */
export type SnapGroup = { id: string; lines: SnapLine[] };
export type SnapHit = { point: LonLat; distPx: number; group: string };

/** Projette le point écran `p` sur le segment [a, b] : coordonnée paramétrique t ∈ [0, 1] et distance. */
export function projectOnSegment(p: Px, a: Px, b: Px): { t: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { t, dist: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) };
}

/**
 * Point le plus proche de `at` (position écran) sur les lignes de `groups`, à moins de `tolPx`. On projette sur le
 * **segment** le plus proche, pas sur le sommet : sinon une longue ligne droite aimante n'importe où (#1437).
 * Le point renvoyé est interpolé entre les deux sommets du segment (en lon/lat, exact à cette échelle).
 */
export function snapToGroups(
  at: Px, groups: SnapGroup[], project: (p: Position) => Px, tolPx: number,
  /** Emprise lon/lat de la zone de tolérance : évite de projeter les milliers de sommets hors de portée (glisser fluide). */
  box?: [number, number, number, number],
): SnapHit | null {
  const out = (a: Position, b: Position) =>
    !!box && ((a[0] < box[0] && b[0] < box[0]) || (a[0] > box[2] && b[0] > box[2]) || (a[1] < box[1] && b[1] < box[1]) || (a[1] > box[3] && b[1] > box[3]));
  for (const g of groups) {
    let best: SnapHit | null = null;
    for (const line of g.lines) {
      const c = line.coordinates;
      if (c.length < 2) continue;
      let prev: Px | null = null;
      for (let i = 1; i < c.length; i++) {
        if (out(c[i - 1], c[i])) {
          prev = null;
          continue;
        }
        prev ??= project(c[i - 1]);
        const cur = project(c[i]);
        // Rejet rapide : le segment est loin de la boîte de tolérance.
        if (
          !(Math.max(prev.x, cur.x) < at.x - tolPx || Math.min(prev.x, cur.x) > at.x + tolPx ||
            Math.max(prev.y, cur.y) < at.y - tolPx || Math.min(prev.y, cur.y) > at.y + tolPx)
        ) {
          const { t, dist } = projectOnSegment(at, prev, cur);
          if (dist <= tolPx && (!best || dist < best.distPx)) {
            best = { point: [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t], distPx: dist, group: g.id };
          }
        }
        prev = cur;
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Aimant BRouter : une fois le tronçon calculé, le waypoint `from`/`to` est ramené sur le début/la fin du tracé
 * si l'écart est sous la tolérance (le routeur a accroché au chemin le plus proche). Renvoie `null` si rien à faire
 * (déjà dessus à ~1 px, ou trop loin : point hors-piste laissé libre).
 */
export function snapEndpoint(waypoint: LonLat, routeEnd: Position, project: (p: Position) => Px, tolPx: number): LonLat | null {
  const a = project(waypoint);
  const b = project(routeEnd);
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return d > 0.5 && d <= tolPx ? [routeEnd[0], routeEnd[1]] : null;
}

/** Largeur (px) des zones de clic de la trace et des alternatives (#1524) : étroite à la souris pour qu'un clic sur une route voisine ajoute un point au lieu d'en insérer un sur la trace. */
export const HIT_WIDTH_TOUCH_PX = 28;
export const HIT_WIDTH_MOUSE_PX = 8;
export const hitWidth = (finePointer: boolean) => (finePointer ? HIT_WIDTH_MOUSE_PX : HIT_WIDTH_TOUCH_PX);

export const snapTolerance = (finePointer: boolean) => (finePointer ? SNAP_TOLERANCE_MOUSE_PX : SNAP_TOLERANCE_TOUCH_PX);
