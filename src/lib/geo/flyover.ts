import { haversine } from './distance';
import type { Position, TrackGeometry } from './types';

/** Pure logic of the 3D flyover (#1690): position at a distance, smoothed heading, duration. No DOM, no MapLibre. */

export type FlyPath = {
  coords: [number, number][];
  /** Cumulative distance (m) at each vertex. */
  cum: number[];
  totalM: number;
};

/** Flattens a geometry into a path with cumulative distances (consecutive duplicate points dropped). */
export function buildFlyPath(geometry: TrackGeometry): FlyPath {
  const raw: Position[] = geometry.type === 'LineString' ? geometry.coordinates : geometry.coordinates.flat();
  const coords: [number, number][] = [];
  const cum: number[] = [];
  let total = 0;
  for (const p of raw) {
    const c: [number, number] = [p[0], p[1]];
    const last = coords[coords.length - 1];
    if (last) {
      const d = haversine(last, c);
      if (d === 0) continue;
      total += d;
    }
    coords.push(c);
    cum.push(total);
  }
  return { coords, cum, totalM: total };
}

/** Index of the segment containing `distM` (cum[i] <= d <= cum[i+1]). */
function segmentAt(path: FlyPath, distM: number): number {
  let lo = 0;
  let hi = path.cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (path.cum[mid] <= distM) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** Position `[lon, lat]` at distance `distM` from the start (clamped to the path). */
export function positionAt(path: FlyPath, distM: number): [number, number] {
  const n = path.coords.length;
  if (n === 0) return [0, 0];
  if (n === 1 || distM <= 0) return path.coords[0];
  if (distM >= path.totalM) return path.coords[n - 1];
  const i = segmentAt(path, distM);
  const span = path.cum[i + 1] - path.cum[i] || 1;
  const f = (distM - path.cum[i]) / span;
  const a = path.coords[i];
  const b = path.coords[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** Compass bearing (degrees, 0 = north, clockwise, 0..360) from a to b. */
export function bearing(a: [number, number], b: [number, number]): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dx = (b[0] - a[0]) * k;
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return 0;
  return (((Math.atan2(dx, dy) * 180) / Math.PI) % 360 + 360) % 360;
}

/** Signed shortest difference (degrees, -180..180) going from `from` to `to`. */
export function angleDiff(from: number, to: number): number {
  const d = (((to - from) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/** Look-ahead distance (m) used to aim the camera: 150 to 300 m, longer on long tracks. */
export function lookAheadM(totalM: number): number {
  return Math.min(300, Math.max(150, totalM / 100));
}

/**
 * Raw heading at `distM`: direction towards the point `lookM` further. Near the end it looks back from the finish
 * (never aims at a single point, which would flip the heading on the last metres).
 */
export function lookAheadHeading(path: FlyPath, distM: number, lookM = lookAheadM(path.totalM)): number {
  const from = positionAt(path, Math.min(distM, Math.max(0, path.totalM - lookM)));
  const to = positionAt(path, Math.min(path.totalM, Math.min(distM, Math.max(0, path.totalM - lookM)) + lookM));
  return bearing(from, to);
}

/**
 * Damped rotation: moves `current` towards `target` with an exponential response of time constant `tauS`
 * (seconds) and a maximum angular speed `maxDegPerS`, so tight turns and out-and-backs never make the camera jump.
 */
export function smoothHeading(current: number, target: number, dtS: number, tauS = 1.2, maxDegPerS = 40): number {
  const diff = angleDiff(current, target);
  const alpha = 1 - Math.exp(-Math.max(0, dtS) / tauS);
  let step = diff * alpha;
  const cap = maxDegPerS * Math.max(0, dtS);
  step = Math.max(-cap, Math.min(cap, step));
  return (((current + step) % 360) + 360) % 360;
}

export const SPEEDS = [1, 2, 4] as const;
export type FlySpeed = (typeof SPEEDS)[number];

/** Duration (ms) at ×1: 60 s per 30 km (2 s/km), within 20 s .. 240 s so short and very long tracks stay watchable. */
export function flyDurationMs(totalM: number, speed: number = 1): number {
  const base = Math.min(240_000, Math.max(20_000, (totalM / 1000) * 2000));
  return base / Math.max(speed, 0.1);
}

/** Next speed in the ×1 → ×2 → ×4 → ×1 cycle. */
export function nextSpeed(s: number): FlySpeed {
  const i = SPEEDS.indexOf(s as FlySpeed);
  return SPEEDS[(i + 1) % SPEEDS.length];
}

/** Index of the profile point at `distM` (profile sorted by `distKm`). */
export function profileIndexAt(profile: { distKm: number }[], distM: number): number {
  if (profile.length === 0) return -1;
  const km = distM / 1000;
  let lo = 0;
  let hi = profile.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (profile[mid].distKm <= km) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Distance (m) along the path of a profile index (click or drag on the profile). Rescaled to the path length. */
export function distanceOfProfileIndex(profile: { distKm: number }[], index: number, totalM: number): number {
  if (profile.length === 0) return 0;
  const last = profile[profile.length - 1].distKm || 1;
  const km = profile[Math.min(Math.max(index, 0), profile.length - 1)].distKm;
  return (km / last) * totalM;
}

/** Small zoom-out in steep slopes: 0 below 8 %, up to `max` zoom levels at 20 %. */
export function slopeZoomOffset(gradePct: number, max = 0.6): number {
  const g = Math.min(Math.abs(gradePct), 20);
  return -(Math.max(0, g - 8) / 12) * max;
}
