/**
 * Pure script of the outing summary player (#1694): where the point stops, how it slows down, what the final slideshow
 * contains. No DOM, no MapLibre: the player (`outing-summary`) only applies these results.
 */

export type SummaryMedia = {
  id: string;
  type: 'photo' | 'video';
  author: string;
  durationMs: number | null;
  /** Distance along the reference track (m); `null` = not placed. */
  distanceM: number | null;
};

/** Media placed within this distance of each other (m) share one stop and play one after the other. */
export const STOP_MERGE_M = 40;
/** The point starts slowing down this far (m) before a stop. */
export const SLOW_ZONE_M = 80;
/** Slowest relative speed just before a stop. */
export const MIN_SLOW = 0.2;
export const PHOTO_MS = 3000;
/** Safety net: a clip that never reports its end is cut after its duration plus this margin. */
export const VIDEO_GRACE_MS = 3000;

export type Stop = { distanceM: number; media: SummaryMedia[] };

/** Placed media grouped into stops, ordered along the track. */
export function buildStops(media: SummaryMedia[]): Stop[] {
  const placed = media.filter((m) => m.distanceM != null).sort((a, b) => (a.distanceM as number) - (b.distanceM as number));
  const stops: Stop[] = [];
  for (const m of placed) {
    const last = stops[stops.length - 1];
    if (last && (m.distanceM as number) - last.distanceM <= STOP_MERGE_M) last.media.push(m);
    else stops.push({ distanceM: m.distanceM as number, media: [m] });
  }
  return stops;
}

/** Icon of a stop (#1704): photos only, videos only, or a mix. */
export function stopKind(stop: Stop): 'photo' | 'video' | 'mixed' {
  const v = stop.media.filter((m) => m.type === 'video').length;
  return v === 0 ? 'photo' : v === stop.media.length ? 'video' : 'mixed';
}

/** Media that are not on the track: final slideshow, in the order they were given. */
export function buildSlides(media: SummaryMedia[]): SummaryMedia[] {
  return media.filter((m) => m.distanceM == null);
}

/** Relative speed (MIN_SLOW..1) at `distM` with the next stop `stopM` ahead: linear ramp over `SLOW_ZONE_M`. */
export function speedFactor(distM: number, stopM: number | null): number {
  if (stopM == null) return 1;
  const left = stopM - distM;
  if (left >= SLOW_ZONE_M) return 1;
  if (left <= 0) return MIN_SLOW;
  return MIN_SLOW + (1 - MIN_SLOW) * (left / SLOW_ZONE_M);
}

/** Cruise speed (m/s at ×1): the track without media lasts 45 to 90 s (2.25 s per km, clamped; #1705: was 60–120 s). */
export function cruiseMps(totalM: number): number {
  const seconds = Math.min(90, Math.max(45, (totalM / 1000) * 2.25));
  return totalM / seconds;
}

/** Index of the first stop strictly after `distM` (`stops.length` if none). */
export function nextStopIndex(stops: Stop[], distM: number): number {
  const i = stops.findIndex((s) => s.distanceM > distM + 1);
  return i === -1 ? stops.length : i;
}

/**
 * Stop to jump to for "previous media": while a stop is shown (`showing`), the one before it; while flying, the last
 * one passed more than 50 m ago. `-1` = restart from the beginning.
 */
export function prevStopIndex(stops: Stop[], distM: number, showing: number | null): number {
  if (showing != null) return showing - 1;
  let i = -1;
  stops.forEach((s, k) => { if (s.distanceM < distM - 50) i = k; });
  return i;
}

export type FlyStep = { distM: number; reached: number | null };

/**
 * Advances the point by `dtS` seconds. `next` = index of the next stop to show: the point slows down towards it, then
 * stops on it and reports `reached`.
 */
export function advanceFly(distM: number, dtS: number, totalM: number, speed: number, stops: Stop[], next: number): FlyStep {
  const stop = next < stops.length ? stops[next] : null;
  const step = cruiseMps(totalM) * speed * speedFactor(distM, stop ? stop.distanceM : null) * dtS;
  const target = distM + step;
  if (stop && target >= stop.distanceM) return { distM: stop.distanceM, reached: next };
  return { distM: Math.min(totalM, target), reached: null };
}

/** How long a media stays on screen (ms): photos 3 s (shorter at higher speed), clips until their end. */
export function mediaDurationMs(m: Pick<SummaryMedia, 'type' | 'durationMs'>, speed: number): number {
  if (m.type === 'video') return (m.durationMs ?? 10_000) + VIDEO_GRACE_MS;
  return PHOTO_MS / Math.max(1, speed);
}

/** Progress 0..1 of the film: the ride then the slideshow share the bar (the slideshow only if it exists). */
export function progressOf(distM: number, totalM: number, slideIndex: number | null, slides: number): number {
  const ride = totalM > 0 ? Math.min(1, distM / totalM) : 0;
  if (slides === 0) return ride;
  const rideShare = 0.9;
  if (slideIndex == null) return ride * rideShare;
  return rideShare + (0.1 * (slideIndex + 1)) / slides;
}

/** Distance (m) for a click at `p` (0..1) on the progress bar; during the slideshow part it is the end of the ride. */
export function distanceOfProgress(p: number, totalM: number, slides: number): number {
  const share = slides === 0 ? 1 : 0.9;
  return Math.min(1, Math.max(0, p / share)) * totalM;
}
