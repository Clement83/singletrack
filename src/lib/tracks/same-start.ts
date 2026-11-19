import { haversine } from '@/lib/geo/distance';

/** Radius (m) under which two start points are "the same" (#1531): one car park, not two junctions. */
export const SAME_START_M = 25;

type WithStart = { slug: string; start: [number, number] };

/** Tracks whose start is `radiusM` metres or less from point `at` (`[lon, lat]`), closest first. */
export function tracksAtStart<T extends WithStart>(tracks: T[], at: [number, number], radiusM = SAME_START_M): T[] {
  return tracks
    .map((t) => ({ t, d: haversine(at, t.start) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d || a.t.slug.localeCompare(b.t.slug))
    .map((x) => x.t);
}

/** Groups the start points "at the same place" (chaining within `radiusM`). Each group keeps the input order. */
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
