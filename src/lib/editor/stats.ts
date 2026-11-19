import { elevationStats, fillElevation, geometryLength, haversine, type Position } from '@/lib/geo';
import { docGeometry, segmentLine, type EditorDoc } from './doc';

export type LiveStats = {
  distanceM: number;
  gainM: number | null;
  lossM: number | null;
  /** True if straight lines (no elevation before saving) are not counted in the elevation. */
  partial: boolean;
  profile: { distKm: number; ele: number; estimated?: boolean }[];
};

/** "Live" stats and profile: the elevation of straight lines is only known after saving (IGN). */
export function liveStats(doc: EditorDoc): LiveStats {
  const g = docGeometry(doc);
  if (!g) return { distanceM: 0, gainM: null, lossM: null, partial: false, profile: [] };
  const lines: Position[][] = doc.segments.map((_, i) => segmentLine(doc, i));
  const withEle = lines.filter((l) => l.every((p) => typeof p[2] === 'number'));
  const e = withEle.length ? elevationStats(withEle) : { gainM: null, lossM: null };
  return {
    distanceM: geometryLength(g),
    gainM: e.gainM,
    lossM: e.lossM,
    partial: withEle.length < lines.length,
    profile: estimatedProfile(g.coordinates),
  };
}

/** One point per geometry vertex, missing elevations estimated by interpolation (#1467). */
function estimatedProfile(coords: Position[]): LiveStats['profile'] {
  const f = fillElevation(coords);
  if (!f) return [];
  let d = 0;
  return coords.map((c, i) => {
    if (i > 0) d += haversine(coords[i - 1], c);
    return { distKm: d / 1000, ele: f.eles[i], ...(f.estimated[i] ? { estimated: true } : {}) };
  });
}
