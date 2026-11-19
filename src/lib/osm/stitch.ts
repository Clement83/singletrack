import type { Position } from '@/lib/geo';

const key = (p: Position) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;

/**
 * Stitches the ways of an OSM relation into ordered lines.
 *
 * The ways of a relation are not necessarily in order nor in the same direction: they are attached
 * end to end (reversed if needed) when they share an end node, then the chains that meet
 * are merged. A gap (unconnected ways) gives several lines; the order of the
 * lines follows the first appearance in the relation.
 */
export function stitchWays(ways: Position[][]): Position[][] {
  let chains: Position[][] = [];
  for (const w of ways) {
    if (w.length < 2) continue;
    let cur = w;
    // Attaches this way to every chain it touches (it may link two).
    for (let i = 0; i < chains.length; ) {
      const merged = join(chains[i], cur);
      if (merged) {
        cur = merged;
        chains.splice(i, 1);
        i = 0; // a merge may allow another one
      } else i++;
    }
    chains.push(cur);
  }
  chains = chains.filter((c) => c.length >= 2);
  return chains;
}

/** Joins two lines if they share an end; `null` otherwise. */
function join(a: Position[], b: Position[]): Position[] | null {
  const aStart = key(a[0]);
  const aEnd = key(a[a.length - 1]);
  const bStart = key(b[0]);
  const bEnd = key(b[b.length - 1]);
  if (aEnd === bStart) return [...a, ...b.slice(1)];
  if (aEnd === bEnd) return [...a, ...[...b].reverse().slice(1)];
  if (aStart === bEnd) return [...b, ...a.slice(1)];
  if (aStart === bStart) return [...[...b].reverse(), ...a.slice(1)];
  return null;
}
