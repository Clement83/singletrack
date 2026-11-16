import { simplifyGeometry } from '@/lib/geo';
import type { TrackGeometry } from '@/lib/geo/types';
import type { TrackRow } from '@/db/schema';

/** Trace figée dans une sortie (#1341) : la sortie ne change pas quand la trace est modifiée. */
export type TrackSnapshot = {
  slug: string;
  name: string;
  geometry: TrackGeometry;
  bbox: [number, number, number, number];
  start: [number, number];
  distanceM: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
  minEle: number | null;
  maxEle: number | null;
  difficulty: TrackRow['difficulty'];
  loop: boolean;
  source: TrackRow['source'];
  license: string | null;
  attribution: string | null;
  author: string | null;
  sourceUrl: string | null;
  takenAt: string;
};

export function snapshotOf(t: TrackRow, now = new Date()): TrackSnapshot {
  return {
    slug: t.slug,
    name: t.name,
    geometry: simplifyGeometry(t.geometry, 5),
    bbox: [t.bboxMinLon, t.bboxMinLat, t.bboxMaxLon, t.bboxMaxLat],
    start: [t.startLon, t.startLat],
    distanceM: t.distanceM,
    elevationGainM: t.elevationGainM,
    elevationLossM: t.elevationLossM,
    minEle: t.minEle,
    maxEle: t.maxEle,
    difficulty: t.difficulty,
    loop: t.loop,
    source: t.source,
    license: t.license,
    attribution: t.attribution,
    author: t.author,
    sourceUrl: t.sourceUrl,
    takenAt: now.toISOString(),
  };
}
