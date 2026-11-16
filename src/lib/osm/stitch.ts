import type { Position } from '@/lib/geo';

const key = (p: Position) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;

/**
 * Recolle les ways d'une relation OSM en lignes ordonnées.
 *
 * Les ways d'une relation ne sont pas forcément dans l'ordre ni dans le même sens : on les accroche
 * bout à bout (en les retournant au besoin) quand ils partagent un nœud d'extrémité, puis on fusionne
 * les chaînes qui se rejoignent. Un trou (ways non connectés) donne plusieurs lignes ; l'ordre des
 * lignes suit la première apparition dans la relation.
 */
export function stitchWays(ways: Position[][]): Position[][] {
  let chains: Position[][] = [];
  for (const w of ways) {
    if (w.length < 2) continue;
    let cur = w;
    // Accroche ce way à toutes les chaînes qu'il touche (il peut en relier deux).
    for (let i = 0; i < chains.length; ) {
      const merged = join(chains[i], cur);
      if (merged) {
        cur = merged;
        chains.splice(i, 1);
        i = 0; // une fusion peut en permettre une autre
      } else i++;
    }
    chains.push(cur);
  }
  chains = chains.filter((c) => c.length >= 2);
  return chains;
}

/** Joint deux lignes si elles partagent une extrémité ; `null` sinon. */
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
