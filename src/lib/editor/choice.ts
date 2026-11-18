import { haversine, type Position } from '@/lib/geo';
import { segmentLine, type EditorDoc, type LonLat, type Segment } from './doc';
import { liveStats, type LiveStats } from './stats';
import type { AltSet } from './alts';

/**
 * Déviation au glisser « contourne aussi les points posés à la main » (#1641).
 *
 * Après un glisser (point ou ligne) vers une route voisine, on route ancre amont → point tiré → ancre aval, où les
 * ancres sont des waypoints **assez loin** (plafonds ci-dessous). En comparant ce tracé à l'ancien, on trouve la
 * divergence et la rejonction ; les waypoints entre les deux sont retirés dans l'option « nouveau » seulement.
 * « Ancien » est le document d'avant le glisser, strictement inchangé. Tout est pur : le routage est fourni par l'appelant.
 */
/** Plafond de tracé (m) parcouru de chaque côté pour chercher une ancre ; au-delà, retour au comportement #1451. */
export const CHOICE_MAX_M = 3000;
/** Plafond de waypoints franchis de chaque côté. */
export const CHOICE_MAX_POINTS = 12;
/** Tolérance (m) pour dire qu'un point du nouveau tracé « suit » l'ancien : 8 m couvre l'écart de deux calculs BRouter sur les mêmes chemins. */
export const CHOICE_TOL_M = 8;

/** Geste de déviation en attente d'être élargi (posé par l'action `deviate`). */
export type PendingDeviation = {
  /** Document d'avant le glisser (= option « ancien »). */
  before: EditorDoc;
  /** Document d'avant, avec le point inséré si c'était un glisser de ligne : sert au calcul. */
  base: EditorDoc;
  /** Indice du point tiré dans `base`. */
  i: number;
  p: LonLat;
  /** Vrai si `base` a un point de plus que `before` (glisser de ligne). */
  inserted: boolean;
};

export type WidenPlan = { up: number | null; down: number | null };

const segLen = (doc: EditorDoc, k: number) => {
  const c = segmentLine(doc, k);
  let s = 0;
  for (let j = 1; j < c.length; j++) s += haversine(c[j - 1], c[j]);
  return s;
};

/** Ancres lointaines à router (indices dans `base`), ou `null` si le comportement habituel suffit. */
export function planWiden(p: PendingDeviation, maxM = CHOICE_MAX_M, maxPts = CHOICE_MAX_POINTS): WidenPlan | null {
  const { base, i } = p;
  const n = base.waypoints.length;
  let a = i;
  for (let cum = 0, c = 0; a > 0 && cum < maxM && c < maxPts; a--, c++) cum += segLen(base, a - 1);
  let b = i;
  for (let cum = 0, c = 0; b < n - 1 && cum < maxM && c < maxPts; b++, c++) cum += segLen(base, b);
  const up = i > 0 ? a : null;
  const down = i < n - 1 ? b : null;
  if ((up === null || up === i - 1) && (down === null || down === i + 1)) return null;
  return { up, down };
}

type XY = [number, number];
const toXY = (c: Position, lat0: number): XY => [c[0] * Math.cos((lat0 * Math.PI) / 180) * 111320, c[1] * 110540];
function distToSeg(q: XY, a: XY, b: XY) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
}
const nearestVertex = (c: Position, path: Position[]) => {
  let best = 0;
  let bd = Infinity;
  path.forEach((v, k) => {
    const d = haversine(c, v);
    if (d < bd) {
      bd = d;
      best = k;
    }
  });
  return best;
};

/** Résultat du calcul : document « nouveau » (tronçons à recalculer) et indices de ses deux nouveaux tronçons. */
export type WidenResult = { doc: EditorDoc; segs: number[]; oldSegs: [number, number] };

/**
 * Construit le document « nouveau » à partir des routes calculées ancre amont → point (`up`) et point → ancre aval
 * (`down`). `null` si le nouveau tracé ne rejoint pas l'ancien dans les plafonds (repli sur #1451) ou ne s'en écarte pas.
 */
export function buildWiden(p: PendingDeviation, plan: WidenPlan, up: Position[] | null, down: Position[] | null, tolM = CHOICE_TOL_M): WidenResult | null {
  const { base, i } = p;
  const wp = base.waypoints;
  const a = plan.up ?? i;
  const b = plan.down ?? i;
  if ((plan.up !== null && !up) || (plan.down !== null && !down)) return null;
  // Ancien tracé d'ancre à ancre, et position (indice de sommet) de chaque waypoint dedans.
  const old: Position[] = [];
  const at: number[] = [];
  for (let k = a; k <= b; k++) {
    at[k] = old.length ? old.length - 1 : 0;
    if (k < b) {
      const line = segmentLine(base, k);
      old.push(...(old.length ? line.slice(1) : line));
    }
  }
  if (old.length < 2) return null;
  at[b] = old.length - 1;
  const lat0 = old[0][1];
  const oldXY = old.map((c) => toXY(c, lat0));
  const near = (c: Position) => {
    const q = toXY(c, lat0);
    let d = Infinity;
    for (let k = 1; k < oldXY.length; k++) d = Math.min(d, distToSeg(q, oldXY[k - 1], oldXY[k]));
    return d <= tolM;
  };
  let lo = 0; // sommet de l'ancien tracé où le nouveau s'en écarte
  let hi = old.length - 1; // sommet où il le rejoint
  if (up) {
    let d = -1;
    while (d + 1 < up.length && near(up[d + 1])) d++;
    if (d >= up.length - 1) return null; // le point tiré est sur l'ancien tracé : rien à contourner
    if (d <= 0 && a > 0 && a < i - 1) return null; // n'a pas rejoint l'ancien tracé dans le plafond
    lo = nearestVertex(up[Math.max(d, 0)], old);
  }
  if (down) {
    let d = down.length;
    while (d - 1 >= 0 && near(down[d - 1])) d--;
    if (d <= 0) return null;
    if (d >= down.length - 1 && b < wp.length - 1 && b > i + 1) return null;
    hi = nearestVertex(down[Math.min(d, down.length - 1)], old);
  }
  if (up && down && lo >= hi) return null;
  let a2 = a;
  for (let k = a; k <= i - 1; k++) if (at[k] <= lo) a2 = k;
  let b2 = b;
  for (let k = b; k >= i + 1; k--) if (at[k] >= hi) b2 = k;
  if (plan.up === null) a2 = i;
  if (plan.down === null) b2 = i;
  const hasL = plan.up !== null;
  const hasR = plan.down !== null;
  const route = (): Segment => ({ mode: 'route', coords: null });
  const waypoints = [...wp.slice(0, hasL ? a2 + 1 : 0), p.p, ...wp.slice(hasR ? b2 : wp.length)];
  const segments = [...base.segments.slice(0, hasL ? a2 : 0), ...(hasL ? [route()] : []), ...(hasR ? [route()] : []), ...base.segments.slice(hasR ? b2 : base.segments.length)];
  const first = hasL ? a2 : 0;
  const segs = [...(hasL ? [first] : []), ...(hasR ? [hasL ? first + 1 : 0] : [])];
  const from = hasL ? a2 : i;
  const to = hasR ? b2 : i;
  return { doc: { waypoints, segments }, segs, oldSegs: [from, Math.max(from, to - (p.inserted ? 1 : 0))] };
}

export type ChoiceWhich = 'new' | 'old';
/** Paire de choix active : les deux documents, celui qui est appliqué, et leurs tronçons (pour masquer les alternatives BRouter). */
export type ChoicePair = {
  selected: ChoiceWhich;
  new: EditorDoc;
  old: EditorDoc;
  newSegs: number[];
  oldSegs: [number, number];
};

export type ChoiceOption = { which: ChoiceWhich; doc: EditorDoc; stats: LiveStats };
/** Les deux options avec km, D+, D− et profil (calculés à la demande : les tracés « nouveau » arrivent du routage). */
export const choiceOptions = (c: ChoicePair): ChoiceOption[] => [
  { which: 'new', doc: c.new, stats: liveStats(c.new) },
  { which: 'old', doc: c.old, stats: liveStats(c.old) },
];

/** Pas d'alternatives BRouter (#1527) pour la portion concernée par une paire de choix. */
export function withoutChoiceAlts(sets: AltSet[], c: ChoicePair | null): AltSet[] {
  if (!c) return sets;
  return sets.filter((s) => (c.selected === 'new' ? !c.newSegs.includes(s.seg) : s.seg < c.oldSegs[0] || s.seg >= c.oldSegs[1]));
}

/** Tronçons (indices dans le document de l'option) qui diffèrent : seuls ceux-là reçoivent halo et étiquette. */
export const choiceSegs = (c: ChoicePair, which: ChoiceWhich): number[] =>
  which === 'new' ? c.newSegs : Array.from({ length: Math.max(0, c.oldSegs[1] - c.oldSegs[0]) }, (_, k) => c.oldSegs[0] + k);

/** Écart de chaque option par rapport à l'autre : km et D+ (null si le dénivelé est inconnu d'un côté). */
export function choiceDeltas(c: ChoicePair): Record<ChoiceWhich, { km: number; gainM: number | null }> {
  const [n, o] = choiceOptions(c);
  const gain = n.stats.gainM !== null && o.stats.gainM !== null ? n.stats.gainM - o.stats.gainM : null;
  const km = (n.stats.distanceM - o.stats.distanceM) / 1000;
  return { new: { km, gainM: gain }, old: { km: -km, gainM: gain === null ? null : -gain } };
}
