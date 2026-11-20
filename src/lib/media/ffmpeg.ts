import { spawn } from 'node:child_process';

/**
 * ffmpeg / ffprobe binaries (#1693). The Docker image ships jellyfin-ffmpeg (QSV-capable) and sets `FFMPEG_PATH` /
 * `FFPROBE_PATH`; elsewhere (CI, a dev machine) the `ffmpeg` / `ffprobe` of the PATH are used.
 */
export const ffmpegPath = () => process.env.FFMPEG_PATH || 'ffmpeg';
export const ffprobePath = () => process.env.FFPROBE_PATH || 'ffprobe';

export type RunResult = { code: number | null; stdout: string; stderr: string };

/** Runs a binary without a shell (arguments as an array: no injection), keeps stdout and the end of stderr. */
export function run(bin: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: -1, stdout, stderr: String(e) });
      return;
    }
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : null;
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    // Only the end of stderr matters (the error), ffmpeg can be verbose.
    child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-8000); });
    child.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}\n${e.message}` }); });
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

/** `true` if ffmpeg answers (tests skip the conversion scenarios without it). */
export async function hasFfmpeg(): Promise<boolean> {
  const [a, b] = await Promise.all([run(ffmpegPath(), ['-hide_banner', '-version']), run(ffprobePath(), ['-hide_banner', '-version'])]);
  return a.code === 0 && b.code === 0;
}

export type VideoProbe = {
  /** ffprobe `format_name`, e.g. `mov,mp4,m4a,3gp,3g2,mj2`. */
  container: string;
  durationMs: number;
  codec: string;
  /** Stored size (before rotation). */
  width: number;
  height: number;
  /** Display rotation in degrees (0, 90, 180, 270). */
  rotation: number;
  /** Displayed size (rotation applied). */
  displayWidth: number;
  displayHeight: number;
  pixFmt: string | null;
  fps: number | null;
  hasAudio: boolean;
  /** Capture time (epoch ms) from the QuickTime metadata. */
  takenAt: number | null;
  pos: { lat: number; lon: number } | null;
};

/**
 * ISO 6709 position as written by phones (`com.apple.quicktime.location.ISO6709`, Android `location` / `©xyz`):
 * `+43.2153+006.0712+123.456/` (altitude optional). `null` if unreadable or out of range.
 */
export function parseIso6709(v: string | undefined | null): { lat: number; lon: number } | null {
  const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec((v ?? '').trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
}

const frac = (v: unknown): number | null => {
  const m = /^(\d+)\/(\d+)$/.exec(String(v ?? ''));
  if (!m || Number(m[2]) === 0) return null;
  const f = Number(m[1]) / Number(m[2]);
  return f > 0 ? f : null;
};

type ProbeJson = {
  format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
  streams?: Array<{
    codec_type?: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string; avg_frame_rate?: string; r_frame_rate?: string;
    duration?: string; tags?: Record<string, string>; side_data_list?: Array<{ rotation?: number }>;
  }>;
};

/** Case-insensitive tag lookup (ffprobe keeps the container's spelling). */
const tag = (tags: Record<string, string> | undefined, ...keys: string[]): string | undefined => {
  if (!tags) return undefined;
  const lower = new Map(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (v) return v;
  }
  return undefined;
};

/** Pure reading of `ffprobe -print_format json -show_format -show_streams`. `null` without a video stream. */
export function parseProbe(j: ProbeJson): VideoProbe | null {
  const v = j.streams?.find((s) => s.codec_type === 'video' && s.width && s.height);
  if (!v) return null;
  const rawRot = v.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ?? Number(tag(v.tags, 'rotate') ?? 0);
  const rotation = (((Math.round(rawRot) % 360) + 360) % 360);
  const swap = rotation === 90 || rotation === 270;
  const dur = Number(j.format?.duration ?? v.duration ?? NaN);
  // Apple writes a local time with an offset (more precise); `creation_time` is UTC but sometimes the upload time.
  const when = tag(j.format?.tags, 'com.apple.quicktime.creationdate') ?? tag(j.format?.tags, 'creation_time') ?? tag(v.tags, 'creation_time');
  const t = when ? Date.parse(when) : NaN;
  const pos = parseIso6709(tag(j.format?.tags, 'com.apple.quicktime.location.ISO6709', 'location', 'location-eng', '©xyz'));
  return {
    container: j.format?.format_name ?? '',
    durationMs: Number.isFinite(dur) ? Math.round(dur * 1000) : 0,
    codec: v.codec_name ?? '',
    width: v.width!, height: v.height!, rotation,
    displayWidth: swap ? v.height! : v.width!, displayHeight: swap ? v.width! : v.height!,
    pixFmt: v.pix_fmt ?? null,
    fps: frac(v.avg_frame_rate) ?? frac(v.r_frame_rate),
    hasAudio: !!j.streams?.some((s) => s.codec_type === 'audio'),
    // A zeroed clock (1904/1970) is not a capture time.
    takenAt: Number.isFinite(t) && t > Date.UTC(2000, 0, 1) ? t : null,
    pos,
  };
}

/** ffprobe of a file. `null` if it is not a readable video. */
export async function probeVideo(file: string): Promise<VideoProbe | null> {
  const r = await run(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 30_000 });
  if (r.code !== 0) return null;
  try {
    return parseProbe(JSON.parse(r.stdout) as ProbeJson);
  } catch {
    return null;
  }
}
