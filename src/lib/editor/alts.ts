import type { Position } from '@/lib/geo';
import type { Quality } from '@/lib/routing/alternatives';

/**
 * Itinéraires alternatifs d'un tronçon (#1386) : `routes[0]` est le recommandé, les suivants les alternatives
 * (avec leur étiquette relative au recommandé). `active` = celui qui est dans le document. Logique pure, testée.
 */
export type AltSet = {
  seg: number;
  from: [number, number];
  to: [number, number];
  routes: Position[][];
  labels: ({ deltaKm: number; quality: Quality } | null)[];
  active: number;
  /** Cycliste du calcul (profil BRouter) : s'il change, le jeu n'est plus valable. */
  sig: string;
  /** Longueur de l'historique au calcul : les jeux d'un geste précédent sont retirés quand un nouveau arrive. */
  gen?: number;
};

export function makeAltSet(
  seg: number, from: [number, number], to: [number, number], best: Position[],
  alts: { coordinates: Position[]; deltaKm: number; quality: Quality }[], sig: string, gen?: number,
): AltSet | null {
  if (!alts.length) return null;
  return {
    seg, from, to, sig, gen, active: 0,
    routes: [best, ...alts.map((a) => a.coordinates)],
    labels: [null, ...alts.map((a) => ({ deltaKm: a.deltaKm, quality: a.quality }))],
  };
}

/** Prochain itinéraire dans l'ordre (recommandé → alt 1 → alt 2 → recommandé). */
export const nextAlt = (s: AltSet): number => (s.active + 1) % s.routes.length;

/**
 * Un jeu par tronçon (#1527) : après un glisser, deux tronçons sont recalculés et chacun garde ses alternatives
 * (avant : le dernier réponse écrasait l'autre). Remplace le jeu du tronçon `seg` (le retire si `set` est `null`).
 */
export const upsertAlt = (sets: AltSet[], seg: number, set: AltSet | null, gen?: number): AltSet[] => [
  ...sets.filter((s) => s.seg !== seg && (gen === undefined || s.gen === gen)),
  ...(set ? [set] : []),
];

/**
 * Jeux encore valables : chacun reste proposé jusqu'au prochain geste qui touche **son** tronçon (le tracé du
 * tronçon n'est plus l'un des itinéraires du jeu), indépendamment des gestes ailleurs dans la trace.
 */
export const liveAltSets = (sets: AltSet[], coordsOf: (seg: number) => Position[] | undefined, rider: string): AltSet[] =>
  sets.flatMap((s) => {
    const cur = coordsOf(s.seg);
    const k = cur ? s.routes.indexOf(cur) : -1; // annuler / rétablir ramène l'un des tracés du jeu : l'actif suit
    return s.sig === rider && k >= 0 ? [k === s.active ? s : { ...s, active: k }] : [];
  });

/** Un jeu reste proposé tant que le cycliste est le même et que le tronçon porte bien l'un des tracés. */
export function liveAlts(s: AltSet | null, sig: string, current: Position[] | undefined): AltSet | null {
  return s && s.sig === sig && current === s.routes[s.active] ? s : null;
}

/** Signature du document pour détecter « le geste suivant » (les tracés calculés n'en font pas partie). */
export const docSig = (waypoints: [number, number][], modes: string[], rider: string) => `${rider}|${modes.join()}|${waypoints.join(';')}`;
