import { haversine, kmAlongTrack, type Position, type TrackGeometry } from '@/lib/geo';

/** Tolerance (ms) around the ridden track's time range: a camera clock a few minutes off still lands on the start/end. */
export const TIME_EDGE_TOLERANCE_MS = 5 * 60_000;
/** Maximum distance (m) between a photo's GPS position and the track for a position-based placement. */
export const POSITION_MAX_M = 150;

export type PlacementMethod = 'time' | 'position' | 'none';
export type Placement = {
  method: PlacementMethod;
  /** Distance along the reference track (m) from its start; `null` when not placed. */
  distanceM: number | null;
  /** Instant on the track (epoch ms) — the photo's time for `time`, the track's time at that point for `position` (null if untimed). */
  at: number | null;
  /** Point on the track `[lon, lat]`; `null` when not placed. */
  pos: [number, number] | null;
};
export type PlacementTrack = { geometry: TrackGeometry; times: number[] | null };
export type PlacementPhoto = { takenAt: number | null; lat: number | null; lon: number | null };

const NONE: Placement = { method: 'none', distanceM: null, at: null, pos: null };
const flat = (g: TrackGeometry): Position[] => (g.type === 'LineString' ? g.coordinates : g.coordinates.flat());

function cumulative(pts: Position[]): number[] {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + haversine(pts[i - 1], pts[i]));
  return c;
}

/** Time (epoch ms) at `distanceM` along the track, interpolated; `null` for an untimed track. */
export function timeAtDistance(track: PlacementTrack, distanceM: number): number | null {
  const pts = flat(track.geometry);
  const ts = track.times;
  if (!ts || ts.length !== pts.length || pts.length < 2) return null;
  const cum = cumulative(pts);
  if (distanceM <= 0) return ts[0];
  for (let i = 0; i < pts.length - 1; i++) {
    if (distanceM <= cum[i + 1]) {
      const len = cum[i + 1] - cum[i];
      return len === 0 ? ts[i] : ts[i] + ((ts[i + 1] - ts[i]) * (distanceM - cum[i])) / len;
    }
  }
  return ts[ts.length - 1];
}

/**
 * Puts a photo on the ridden reference track (#1692):
 * 1. by time — position interpolated at `takenAt` if it falls in the track's time range (± `TIME_EDGE_TOLERANCE_MS`, clamped to the ends);
 * 2. otherwise by GPS position — the closest point of the track, if within `POSITION_MAX_M`;
 * 3. otherwise not placed.
 */
export function placePhoto(track: PlacementTrack, photo: PlacementPhoto): Placement {
  const pts = flat(track.geometry);
  if (pts.length < 2) return NONE;
  const ts = track.times && track.times.length === pts.length ? track.times : null;
  if (ts && photo.takenAt != null) {
    const t0 = ts[0];
    const tn = ts[ts.length - 1];
    if (photo.takenAt >= t0 - TIME_EDGE_TOLERANCE_MS && photo.takenAt <= tn + TIME_EDGE_TOLERANCE_MS) {
      const at = Math.min(tn, Math.max(t0, photo.takenAt));
      const cum = cumulative(pts);
      let i = 0;
      while (i < pts.length - 2 && !(ts[i] <= at && at <= ts[i + 1])) i++;
      const dt = ts[i + 1] - ts[i];
      const f = dt > 0 ? Math.min(1, Math.max(0, (at - ts[i]) / dt)) : 0;
      const a = pts[i];
      const b = pts[i + 1];
      return {
        method: 'time',
        distanceM: Math.round(cum[i] + f * (cum[i + 1] - cum[i])),
        at: Math.round(at),
        pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
      };
    }
  }
  if (photo.lat != null && photo.lon != null) {
    const r = kmAlongTrack(pts, photo.lon, photo.lat);
    if (r && r.distM <= POSITION_MAX_M && r.kms.length > 0) {
      const distanceM = Math.round(r.kms[0] * 1000);
      const at = timeAtDistance({ geometry: track.geometry, times: ts }, distanceM);
      return { method: 'position', distanceM, at: at == null ? null : Math.round(at), pos: [photo.lon, photo.lat] };
    }
  }
  return NONE;
}
