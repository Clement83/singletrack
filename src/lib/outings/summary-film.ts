/**
 * Deterministic film of the outing summary for the MP4 export (#1707): the same script as the live player (#1694, #1705)
 * unrolled frame by frame at a fixed rate — no timers, no requestAnimationFrame. Pure: the exporter only renders it.
 */
import { gradeAt } from '@/lib/elevation';
import { lookAheadHeading, slopeZoomOffset, smoothHeading, type FlyPath } from '@/lib/geo/flyover';
import { advanceFly, PHOTO_MS, type Stop, type SummaryMedia } from './summary-script';

export const FILM_FPS = 30;
/** Still frames before the point starts and after the last media. */
export const INTRO_MS = 1000;
export const OUTRO_MS = 2000;
/** Guard: a film never exceeds one hour. */
const MAX_FRAMES = FILM_FPS * 3600;

export type FilmMedia = { m: SummaryMedia; atMs: number; durMs: number };
export type FilmFrame = { dist: number; heading: number; zoomOff: number; media: FilmMedia | null };
export type FilmClip = { id: string; startMs: number; durMs: number };
export type Film = { fps: number; frames: FilmFrame[]; clips: FilmClip[]; durationMs: number };

export type FilmInput = {
  path: FlyPath;
  stops: Stop[];
  slides: SummaryMedia[];
  /** Distance (km) of each profile point, `null` without elevation: zoom stays constant. */
  profileKm: number[] | null;
  grades: number[];
  /** `prefers-reduced-motion`: the camera keeps its heading. */
  reduced?: boolean;
};

/** How long a media stays in the film (ms): photo 3 s, clip its own length (10 s if unknown). */
export function filmMediaMs(m: Pick<SummaryMedia, 'type' | 'durationMs'>): number {
  return m.type === 'video' ? (m.durationMs ?? 10_000) : PHOTO_MS;
}

export function buildFilm(input: FilmInput, fps = FILM_FPS): Film {
  const { path, stops, slides, profileKm, grades, reduced = false } = input;
  const total = path.totalM;
  const dt = 1 / fps;
  const frames: FilmFrame[] = [];
  const clips: FilmClip[] = [];
  let dist = 0;
  let heading = lookAheadHeading(path, 0);
  let zoomOff = 0;
  let next = 0;
  let held: number | null = null;

  const push = (media: FilmMedia | null) => {
    if (frames.length < MAX_FRAMES) frames.push({ dist, heading, zoomOff, media });
  };
  /** One step of riding; returns the stop reached, if any. */
  const ride = (): number | null => {
    const r = advanceFly(dist, dt, total, 1, stops, next);
    dist = r.distM;
    if (!reduced) heading = smoothHeading(heading, lookAheadHeading(path, dist), dt, 1.2, 40);
    if (profileKm) {
      const gi = Math.max(0, profileKm.findIndex((km) => km * 1000 >= dist));
      zoomOff += (slopeZoomOffset(gradeAt(grades, gi) ?? 0) - zoomOff) * (1 - Math.exp(-dt / 1.5));
    }
    return r.reached;
  };
  /** A media on screen; a clip lets the point ride on (#1705) until the next stop, which is then held. */
  const show = (m: SummaryMedia, mayRide: boolean) => {
    const durMs = filmMediaMs(m);
    const n = Math.max(1, Math.round((durMs * fps) / 1000));
    if (m.type === 'video') clips.push({ id: m.id, startMs: (frames.length * 1000) / fps, durMs });
    for (let i = 0; i < n; i++) {
      push({ m, atMs: (i * 1000) / fps, durMs });
      if (mayRide && m.type === 'video' && held == null && dist < total) {
        const r = ride();
        if (r != null) held = r;
      }
    }
  };
  const still = (ms: number) => { for (let i = 0; i < Math.round((ms * fps) / 1000); i++) push(null); };

  still(INTRO_MS);
  while (frames.length < MAX_FRAMES) {
    let k: number;
    if (held != null) {
      k = held;
      held = null;
    } else {
      let reached: number | null = null;
      while (reached == null && dist < total && frames.length < MAX_FRAMES) {
        push(null);
        reached = ride();
      }
      if (reached == null) break;
      k = reached;
    }
    next = k + 1;
    for (const m of stops[k].media) show(m, true);
  }
  for (const m of slides) show(m, false);
  still(OUTRO_MS);
  return { fps, frames, clips, durationMs: (frames.length * 1000) / fps };
}

export type GainPoint = { t: number; g: number };

/**
 * Volume of the background music over the film (seconds, linear ramps between points): fade in, lowered under each
 * clip so its own sound is heard, fade out. Clips closer than two ramps are merged (no pumping between them).
 */
export function musicEnvelope(
  clips: Pick<FilmClip, 'startMs' | 'durMs'>[],
  durationMs: number,
  { base = 0.8, duck = 0.2, rampMs = 400, fadeInMs = 1000, fadeOutMs = 2500 } = {},
): GainPoint[] {
  const end = durationMs / 1000;
  const ramp = rampMs / 1000;
  const spans: [number, number][] = [];
  for (const c of [...clips].sort((a, b) => a.startMs - b.startMs)) {
    const s = c.startMs / 1000;
    const e = (c.startMs + c.durMs) / 1000;
    const last = spans[spans.length - 1];
    if (last && s - last[1] < 2 * ramp) last[1] = Math.max(last[1], e);
    else spans.push([s, e]);
  }
  const pts: GainPoint[] = [{ t: 0, g: 0 }, { t: Math.min(fadeInMs / 1000, end), g: base }];
  for (const [s, e] of spans) {
    pts.push({ t: Math.max(0, s - ramp), g: base }, { t: s, g: duck }, { t: e, g: duck }, { t: e + ramp, g: base });
  }
  const fadeAt = Math.max(0, end - fadeOutMs / 1000);
  // Points past the fade-out start are dropped; the fade starts from whatever level the music had then.
  const kept = pts.filter((p) => p.t <= fadeAt).sort((a, b) => a.t - b.t);
  const at = (t: number) => {
    const i = kept.findIndex((p) => p.t >= t);
    if (i <= 0) return i === 0 ? kept[0].g : kept[kept.length - 1].g;
    const a = kept[i - 1];
    const b = kept[i];
    return b.t === a.t ? b.g : a.g + ((b.g - a.g) * (t - a.t)) / (b.t - a.t);
  };
  // Ducked at the fade start if a clip runs over it.
  const inClip = spans.some(([s, e]) => fadeAt >= s && fadeAt <= e);
  kept.push({ t: fadeAt, g: inClip ? duck : at(fadeAt) }, { t: end, g: 0 });
  return kept.sort((a, b) => a.t - b.t);
}
