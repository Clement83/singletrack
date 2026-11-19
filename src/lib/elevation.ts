export type ProfilePoint = { distKm: number; ele: number; /** Estimated (interpolated) elevation, not measured (#1467). */ estimated?: boolean };

/** Index of the profile point closest to `x` (0..width), for a finger drag. */
export function indexAtX(points: ProfilePoint[], x: number, width: number): number {
  if (points.length === 0 || width <= 0) return -1;
  const max = points[points.length - 1].distKm || 1;
  const target = (Math.min(Math.max(x, 0), width) / width) * max;
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].distKm - target) < Math.abs(points[best].distKm - target)) best = i;
  }
  return best;
}

/** Located profile point (for the marker synchronised on the map). */
export type LocatedProfilePoint = ProfilePoint & { lon: number; lat: number };

/**
 * Index of the profile point closest to a map position (hovering the track → profile cursor, #1391).
 * Equirectangular distance: enough at the scale of a track. -1 if the profile is empty.
 */
export function nearestProfileIndex(points: { lon: number; lat: number }[], lon: number, lat: number): number {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = (points[i].lon - lon) * k;
    const dy = points[i].lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Slope (%) shown under the cursor of point `i`: the one of the edge starting at this point (or reaching the
 * last one). `grades` = the profile's `edgeGrades` (one value per edge).
 */
export function gradeAt(grades: number[], i: number): number | null {
  if (grades.length === 0 || i < 0) return null;
  return grades[Math.min(i, grades.length - 1)] ?? null;
}
