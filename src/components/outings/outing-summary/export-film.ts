/**
 * MP4 export of the outing summary, in the browser (#1707): renders the deterministic film (`buildFilm`) frame by frame
 * on an off-screen MapLibre map with the 3D relief, composes the overlays on a canvas, encodes with WebCodecs and muxes
 * with `mp4-muxer`. Sound: instance background music (#1706) lowered under the clips + the clips' own sound.
 */
import maplibregl from 'maplibre-gl';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { slopeColorsOf } from '@/components/map/slope-route-layer';
import type { MapColors } from '@/components/tracks/use-map-colors';
import { BASE_ZOOM, PITCH } from '@/components/map/flyover';
import { BASE_CREDITS, BASE_STYLE_WITH_DEM } from '@/lib/map/base-style';
import { TERRAIN } from '@/lib/map/terrain';
import { positionAt, type FlyPath } from '@/lib/geo/flyover';
import { slopeFeatures, slopeMatchExpression } from '@/lib/geo/slope-features';
import type { TrackGeometry } from '@/lib/geo/types';
import { musicEnvelope, type Film, type FilmFrame } from '@/lib/outings/summary-film';
import type { Stop, SummaryMedia } from '@/lib/outings/summary-script';

export type ExportFormat = 'landscape' | 'portrait';
export const EXPORT_SIZE: Record<ExportFormat, { w: number; h: number }> = { landscape: { w: 1920, h: 1080 }, portrait: { w: 1080, h: 1920 } };

export type ExportInput = {
  film: Film;
  path: FlyPath;
  geometry: TrackGeometry;
  stops: Stop[];
  colors: MapColors;
  /** File URL of a media (`thumb` = still image of a clip). */
  url: (m: SummaryMedia, thumb?: boolean) => string;
  /** Text of the stats box at a given distance (km · elevation gain). */
  stats: (distM: number) => string;
  /** "by X" caption of a media, empty for the organiser. */
  caption: (m: SummaryMedia) => string;
  musicUrl: string | null;
};
export type ExportOptions = { format: ExportFormat; signal: AbortSignal; onProgress: (p: number) => void };

const SAMPLE_RATE = 48_000;
const VIDEO_CODECS = [
  { codec: 'avc1.640028', mux: 'avc' as const },
  { codec: 'avc1.4d0028', mux: 'avc' as const },
  { codec: 'vp09.00.40.08', mux: 'vp9' as const },
  { codec: 'vp09.00.10.08', mux: 'vp9' as const },
];
const AUDIO_CODECS = [{ codec: 'mp4a.40.2', mux: 'aac' as const }, { codec: 'opus', mux: 'opus' as const }];

/** WebCodecs present (secure context, recent browser): the export button is shown. */
export function canExport(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof VideoEncoder !== 'undefined';
}

export class ExportUnsupported extends Error {}

const abortError = () => new DOMException('aborted', 'AbortError');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pickVideo(w: number, h: number, fps: number) {
  for (const c of VIDEO_CODECS) {
    const config: VideoEncoderConfig = { codec: c.codec, width: w, height: h, bitrate: 6_000_000, framerate: fps, latencyMode: 'quality' };
    if ((await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }))).supported) return { ...c, config };
  }
  return null;
}

async function pickAudio() {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const c of AUDIO_CODECS) {
    const config: AudioEncoderConfig = { codec: c.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160_000 };
    if ((await AudioEncoder.isConfigSupported(config).catch(() => ({ supported: false }))).supported) return { ...c, config };
  }
  return null;
}

async function decode(ctx: BaseAudioContext, url: string, signal: AbortSignal): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch (e) {
    if (signal.aborted) throw abortError();
    void e;
    return null; // a clip without sound, an unreadable track: silence
  }
}

/** Sound track of the film: looped music with its envelope + each clip's sound at its place. */
async function renderAudio(input: ExportInput, signal: AbortSignal): Promise<AudioBuffer> {
  const { film } = input;
  const seconds = Math.max(1, film.durationMs / 1000);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  if (input.musicUrl) {
    const music = await decode(ctx, input.musicUrl, signal);
    if (music) {
      const src = ctx.createBufferSource();
      src.buffer = music;
      src.loop = true;
      const gain = ctx.createGain();
      const pts = musicEnvelope(film.clips, film.durationMs);
      gain.gain.setValueAtTime(pts[0].g, 0);
      for (const p of pts.slice(1)) gain.gain.linearRampToValueAtTime(p.g, p.t);
      src.connect(gain).connect(ctx.destination);
      src.start(0);
    }
  }
  for (const c of film.clips) {
    const buf = await decode(ctx, input.url({ id: c.id, type: 'video', author: '', durationMs: c.durMs, distanceM: null }), signal);
    if (!buf) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(c.startMs / 1000, 0, c.durMs / 1000);
  }
  return ctx.startRendering();
}

async function encodeAudio(buf: AudioBuffer, codec: NonNullable<Awaited<ReturnType<typeof pickAudio>>>, muxer: Muxer<ArrayBufferTarget>) {
  let failed: unknown = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failed = e; } });
  enc.configure(codec.config);
  const step = 4800;
  const left = buf.getChannelData(0);
  const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : left;
  for (let i = 0; i < buf.length; i += step) {
    const n = Math.min(step, buf.length - i);
    const data = new Float32Array(n * 2);
    data.set(left.subarray(i, i + n), 0);
    data.set(right.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i * 1e6) / SAMPLE_RATE), data });
    enc.encode(ad);
    ad.close();
    if (failed) throw failed;
  }
  await enc.flush();
  enc.close();
  if (failed) throw failed;
}

/**
 * Waits until the map has drawn the current camera with its tiles (bounded). `idle` alone is not enough: a tile in error
 * (no relief there, network) keeps it from ever firing, so a render with every tile settled (loaded or errored) counts.
 */
function settle(map: maplibregl.Map, capMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off('idle', fin);
      map.off('render', onRender);
      resolve();
    };
    const onRender = () => { if (map.areTilesLoaded() && !map.isMoving()) fin(); };
    const timer = setTimeout(fin, capMs);
    map.once('idle', fin);
    map.on('render', onRender);
    map.triggerRepaint();
  });
}

async function makeMap(input: ExportInput, w: number, h: number): Promise<{ map: maplibregl.Map; box: HTMLDivElement }> {
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, { position: 'fixed', left: '-100000px', top: '0', width: `${w}px`, height: `${h}px`, pointerEvents: 'none' });
  document.body.appendChild(box);
  const start = positionAt(input.path, 0);
  const map = new maplibregl.Map({
    container: box,
    style: BASE_STYLE_WITH_DEM,
    center: start,
    zoom: BASE_ZOOM,
    pitch: PITCH,
    interactive: false,
    attributionControl: false,
    pixelRatio: 1,
    fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
  });
  await new Promise<void>((resolve, reject) => {
    map.once('load', () => resolve());
    map.once('error', (e) => { if (!map.loaded()) reject(e.error); });
  });
  try { map.setTerrain(TERRAIN); } catch { /* flat map: the film still renders */ }
  const c = input.colors;
  map.addSource('route', { type: 'geojson', data: slopeFeatures(input.geometry) as never });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.card, 'line-width': 12 } });
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': slopeMatchExpression(slopeColorsOf(c), c.muted, c.primary) as never, 'line-width': 7 },
  });
  return { map, box };
}

/** Cache of decoded media: photos as images, clips as muted `<video>` elements sought frame by frame. */
class Media {
  private images = new Map<string, Promise<HTMLImageElement | null>>();
  private videos = new Map<string, Promise<HTMLVideoElement | null>>();
  constructor(private url: ExportInput['url']) {}
  image(m: SummaryMedia): Promise<HTMLImageElement | null> {
    let p = this.images.get(m.id);
    if (!p) {
      const img = new Image();
      img.decoding = 'async';
      img.src = this.url(m, m.type === 'video');
      p = img.decode().then(() => img, () => null);
      this.images.set(m.id, p);
    }
    return p;
  }
  video(m: SummaryMedia): Promise<HTMLVideoElement | null> {
    let p = this.videos.get(m.id);
    if (!p) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = this.url(m);
      p = new Promise((resolve) => {
        v.addEventListener('loadeddata', () => resolve(v), { once: true });
        v.addEventListener('error', () => resolve(null), { once: true });
      });
      this.videos.set(m.id, p);
    }
    return p;
  }
  async frameOf(m: SummaryMedia, atMs: number): Promise<CanvasImageSource | null> {
    const v = await this.video(m);
    if (!v) return this.image(m);
    const t = Math.min(atMs / 1000, Math.max(0, (v.duration || 0) - 0.05));
    if (Math.abs(v.currentTime - t) > 0.001) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        v.addEventListener('seeked', done, { once: true });
        setTimeout(done, 2000);
        v.currentTime = t;
      });
    }
    return v;
  }
  /** Frees a clip once the film is past it. */
  drop(id: string) {
    const p = this.videos.get(id);
    if (!p) return;
    this.videos.delete(id);
    void p.then((v) => { if (v) { v.removeAttribute('src'); v.load(); } });
  }
  dispose() { for (const id of [...this.videos.keys()]) this.drop(id); }
}

/** Value of a colour token (`--media-surface`…): the canvas cannot read `var()`. */
function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fit(sw: number, sh: number, bw: number, bh: number) {
  const k = Math.min(bw / sw, bh / sh);
  return { w: sw * k, h: sh * k };
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ring: string, ringW: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = ringW;
  ctx.strokeStyle = ring;
  ctx.stroke();
}

/** Renders the film and returns the MP4. Throws `AbortError` when cancelled, `ExportUnsupported` without codecs. */
export async function exportFilm(input: ExportInput, { format, signal, onProgress }: ExportOptions): Promise<Blob> {
  // Test hook (e2e, software WebGL): a small render of the first frames only.
  const hook = (window as { __singletrackExport?: { maxFrames?: number; scale?: number } }).__singletrackExport;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const w = even(EXPORT_SIZE[format].w * (hook?.scale ?? 1));
  const h = even(EXPORT_SIZE[format].h * (hook?.scale ?? 1));
  const { film } = input;
  const video = await pickVideo(w, h, film.fps);
  if (!video) throw new ExportUnsupported('no video encoder');
  const audio = await pickAudio();
  const frames: FilmFrame[] = hook?.maxFrames ? film.frames.slice(0, hook.maxFrames) : film.frames;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: video.mux, width: w, height: h, frameRate: film.fps },
    audio: audio ? { codec: audio.mux, numberOfChannels: 2, sampleRate: SAMPLE_RATE } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  const audioShare = audio ? 0.08 : 0;
  if (audio) {
    const buf = await renderAudio({ ...input, film: { ...film, durationMs: (frames.length * 1000) / film.fps } }, signal);
    if (signal.aborted) throw abortError();
    await encodeAudio(buf, audio, muxer);
  }
  onProgress(audioShare);

  const media = new Media(input.url);
  const { map, box } = await makeMap(input, w, h);
  let failed: unknown = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
  try {
    encoder.configure(video.config);
    await document.fonts.ready;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const s = Math.min(w, h) / 1080;
    const surface = cssColor('--media-surface');
    const onSurface = cssColor('--media-foreground');
    const c = input.colors;
    const font = (px: number, weight = 600) => `${weight} ${Math.round(px * s)}px Inter Variable, Inter, system-ui, sans-serif`;
    let last: FilmFrame | null = null;
    let lastClip: string | null = null;

    for (let i = 0; i < frames.length; i++) {
      if (signal.aborted) throw abortError();
      if (failed) throw failed;
      const f = frames[i];
      const moved = !last || last.dist !== f.dist || last.heading !== f.heading || last.zoomOff !== f.zoomOff;
      if (moved) {
        map.jumpTo({ center: positionAt(input.path, f.dist), bearing: f.heading, pitch: PITCH, zoom: BASE_ZOOM + f.zoomOff });
        await settle(map, i === 0 ? 20_000 : 4000);
      }
      last = f;
      ctx.drawImage(map.getCanvas(), 0, 0, w, h);

      // Stops then the point, projected on the relief.
      for (const st of input.stops) {
        const p = map.project(positionAt(input.path, st.distanceM));
        if (p.x > -40 && p.x < w + 40 && p.y > -40 && p.y < h + 40) dot(ctx, p.x, p.y, 13 * s, c.primary, onSurface, 4 * s);
      }
      const pt = map.project(positionAt(input.path, f.dist));
      dot(ctx, pt.x, pt.y, 18 * s, c.primary, onSurface, 6 * s);

      // Media over the map: photo full frame with a slow zoom, clip inset (the map keeps moving underneath).
      const md = f.media;
      if (lastClip && md?.m.id !== lastClip) { media.drop(lastClip); lastClip = null; }
      if (md) {
        const top = (format === 'portrait' ? 220 : 110) * s;
        if (md.m.type === 'photo') {
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = surface;
          ctx.fillRect(0, 0, w, h);
          ctx.globalAlpha = 1;
          const img = await media.image(md.m);
          if (img) {
            const box2 = fit(img.naturalWidth, img.naturalHeight, w * 0.94, h - top * 2);
            const z = 1 + 0.06 * Math.min(1, md.atMs / md.durMs);
            const bw = box2.w * z;
            const bh = box2.h * z;
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, top, w, h - top * 2);
            ctx.clip();
            ctx.drawImage(img, (w - bw) / 2, (h - bh) / 2, bw, bh);
            ctx.restore();
          }
        } else {
          lastClip = md.m.id;
          const src = await media.frameOf(md.m, md.atMs);
          const vw = src instanceof HTMLVideoElement ? src.videoWidth : src instanceof HTMLImageElement ? src.naturalWidth : 16;
          const vh = src instanceof HTMLVideoElement ? src.videoHeight : src instanceof HTMLImageElement ? src.naturalHeight : 9;
          const b = fit(vw || 16, vh || 9, w * (format === 'portrait' ? 0.92 : 0.6), h * 0.55);
          const x = (w - b.w) / 2;
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.shadowColor = surface;
          ctx.shadowBlur = 40 * s;
          roundRect(ctx, x, top, b.w, b.h, 24 * s);
          ctx.fillStyle = surface;
          ctx.fill();
          ctx.restore();
          if (src) {
            ctx.save();
            roundRect(ctx, x, top, b.w, b.h, 24 * s);
            ctx.clip();
            ctx.drawImage(src, x, top, b.w, b.h);
            ctx.restore();
          }
        }
        const cap = input.caption(md.m);
        if (cap) {
          ctx.font = font(30, 500);
          const tw = ctx.measureText(cap).width;
          const y = h - (format === 'portrait' ? 260 : 120) * s;
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = surface;
          roundRect(ctx, 32 * s, y, tw + 40 * s, 52 * s, 26 * s);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = onSurface;
          ctx.textBaseline = 'middle';
          ctx.fillText(cap, 52 * s, y + 26 * s);
        }
      }

      // Stats box, credits.
      ctx.font = font(34);
      const txt = input.stats(f.dist);
      const tw = ctx.measureText(txt).width;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = surface;
      roundRect(ctx, 32 * s, 32 * s, tw + 48 * s, 68 * s, 16 * s);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = onSurface;
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, 56 * s, 66 * s);
      ctx.font = font(20, 500);
      ctx.textAlign = 'right';
      ctx.shadowColor = surface;
      ctx.shadowBlur = 6 * s;
      ctx.fillText(BASE_CREDITS, w - 24 * s, h - 24 * s);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';

      const vf = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / film.fps), duration: Math.round(1e6 / film.fps) });
      encoder.encode(vf, { keyFrame: i % (film.fps * 2) === 0 });
      vf.close();
      while (encoder.encodeQueueSize > 6) await sleep(5);
      if (i % 5 === 0) onProgress(audioShare + (1 - audioShare) * ((i + 1) / frames.length));
    }
    await encoder.flush();
    if (failed) throw failed;
    muxer.finalize();
    onProgress(1);
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    media.dispose();
    map.remove();
    box.remove();
  }
}
