import type { Position } from '@/lib/geo';
import type { Quality } from '@/lib/routing/alternatives';

/**
 * Alternative routes of a segment (#1386): `routes[0]` is the recommended one, the next ones the alternatives
 * (with their label relative to the recommended one). `active` = the one in the document. Pure logic, tested.
 */
export type AltSet = {
  seg: number;
  from: [number, number];
  to: [number, number];
  routes: Position[][];
  labels: ({ deltaKm: number; quality: Quality } | null)[];
  active: number;
  /** Rider used for the computation (BRouter profile): if it changes, the set is no longer valid. */
  sig: string;
  /** History length at computation time: sets from a previous gesture are removed when a new one arrives. */
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

/** Next route in order (recommended → alt 1 → alt 2 → recommended). */
export const nextAlt = (s: AltSet): number => (s.active + 1) % s.routes.length;

/**
 * One set per segment (#1527): after a drag, two segments are recomputed and each keeps its alternatives
 * (before: the last answer overwrote the other). Replaces the set of segment `seg` (removes it if `set` is `null`).
 */
export const upsertAlt = (sets: AltSet[], seg: number, set: AltSet | null, gen?: number): AltSet[] => [
  ...sets.filter((s) => s.seg !== seg && (gen === undefined || s.gen === gen)),
  ...(set ? [set] : []),
];

/**
 * Sets still valid: each stays offered until the next gesture that touches **its** segment (the segment's line
 * is no longer one of the set's routes), regardless of gestures elsewhere in the track.
 */
export const liveAltSets = (sets: AltSet[], coordsOf: (seg: number) => Position[] | undefined, rider: string): AltSet[] =>
  sets.flatMap((s) => {
    const cur = coordsOf(s.seg);
    const k = cur ? s.routes.indexOf(cur) : -1; // undo / redo brings back one of the set's lines: the active one follows
    return s.sig === rider && k >= 0 ? [k === s.active ? s : { ...s, active: k }] : [];
  });

/** A set stays offered as long as the rider is the same and the segment carries one of its lines. */
export function liveAlts(s: AltSet | null, sig: string, current: Position[] | undefined): AltSet | null {
  return s && s.sig === sig && current === s.routes[s.active] ? s : null;
}

/** Document signature to detect "the next gesture" (computed lines are not part of it). */
export const docSig = (waypoints: [number, number][], modes: string[], rider: string) => `${rider}|${modes.join()}|${waypoints.join(';')}`;
