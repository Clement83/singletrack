import { haversine } from '@/lib/geo/distance';

/** Rayon (m) sous lequel deux départs sont « le même » (#1531) : un parking, pas deux carrefours. */
export const SAME_START_M = 25;

type WithStart = { slug: string; start: [number, number] };

/** Traces dont le départ est à `radiusM` mètres ou moins du point `at` (`[lon, lat]`), les plus proches d'abord. */
export function tracksAtStart<T extends WithStart>(tracks: T[], at: [number, number], radiusM = SAME_START_M): T[] {
  return tracks
    .map((t) => ({ t, d: haversine(at, t.start) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d || a.t.slug.localeCompare(b.t.slug))
    .map((x) => x.t);
}

/** Regroupe les départs « au même endroit » (chaînage à moins de `radiusM`). Chaque groupe garde l'ordre d'entrée. */
export function groupSameStart<T extends WithStart>(tracks: T[], radiusM = SAME_START_M): T[][] {
  const groups: T[][] = [];
  const left = [...tracks];
  while (left.length) {
    const group = [left.shift()!];
    for (let i = 0; i < group.length; i++) {
      for (let j = left.length - 1; j >= 0; j--) {
        if (haversine(group[i].start, left[j].start) <= radiusM) group.push(...left.splice(j, 1));
      }
    }
    groups.push(group);
  }
  return groups;
}
