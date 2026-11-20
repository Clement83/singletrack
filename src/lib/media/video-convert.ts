import { accessSync, constants, rmSync } from 'node:fs';
import { ffmpegPath, probeVideo, run, type VideoProbe } from './ffmpeg';
import { qsvArgs, thumbArgs, x264Args } from './video-args';

export type EncoderMode = 'auto' | 'qsv' | 'x264';
export type Encoder = 'h264_qsv' | 'libx264';

/** `VIDEO_ENCODER` = `auto` (default: QSV when the iGPU render node is accessible) | `qsv` | `x264`. */
export function encoderMode(env = process.env.VIDEO_ENCODER): EncoderMode {
  const v = env?.trim().toLowerCase();
  return v === 'qsv' || v === 'x264' ? v : 'auto';
}

/** Render node of the iGPU (`/dev/dri/renderD128` by default, `VIDEO_QSV_DEVICE` otherwise), readable and writable. */
export function gpuAvailable(node = process.env.VIDEO_QSV_DEVICE || '/dev/dri/renderD128'): boolean {
  try {
    accessSync(node, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Encoders to try, in order: QSV first when wanted and possible, x264 always as the fallback. */
export function encoderPlan(mode: EncoderMode, gpu: boolean): Encoder[] {
  if (mode === 'x264') return ['libx264'];
  if (mode === 'qsv' || gpu) return ['h264_qsv', 'libx264'];
  return ['libx264'];
}

/** A clip of 30 s converts in seconds; anything stuck that long is killed. */
const TIMEOUT_MS = 10 * 60_000;

export type ConvertResult =
  | { ok: true; encoder: Encoder; width: number; height: number; durationMs: number }
  | { ok: false; error: string };

/**
 * Converts `input` into `output` (MP4 H.264 720p, metadata stripped) and writes the thumbnail `thumb`.
 * QSV failure (no device, unsupported codec, driver) ⇒ automatic, logged fallback to libx264.
 */
export async function convertVideo(input: string, output: string, thumb: string, p: VideoProbe, opts: { plan?: Encoder[]; qsvDevice?: string } = {}): Promise<ConvertResult> {
  let plan = opts.plan;
  if (!plan) {
    const mode = encoderMode();
    const gpu = gpuAvailable();
    plan = encoderPlan(mode, gpu);
    if (mode === 'auto' && !gpu) console.info('[Video] iGPU not accessible (no /dev/dri render node): software fallback libx264');
  }
  let last = 'no encoder';
  for (const enc of plan) {
    const args = enc === 'h264_qsv' ? qsvArgs(input, output, p, opts.qsvDevice) : x264Args(input, output, p);
    const started = Date.now();
    const r = await run(ffmpegPath(), args, { timeoutMs: TIMEOUT_MS });
    const out = r.code === 0 ? await probeVideo(output) : null;
    if (out && out.codec === 'h264') {
      console.info(`[Video] encoder=${enc} ${out.displayWidth}x${out.displayHeight} ${out.durationMs} ms in ${Date.now() - started} ms`);
      const t = await run(ffmpegPath(), thumbArgs(output, thumb), { timeoutMs: 60_000 });
      if (t.code !== 0) {
        rmSync(output, { force: true });
        return { ok: false, error: `thumbnail: ${t.stderr.trim().split('\n').slice(-3).join(' | ')}` };
      }
      return { ok: true, encoder: enc, width: out.displayWidth, height: out.displayHeight, durationMs: out.durationMs };
    }
    rmSync(output, { force: true });
    last = r.stderr.trim().split('\n').slice(-3).join(' | ');
    if (enc === 'h264_qsv') console.warn(`[Video] encoder=h264_qsv failed, falling back to libx264: ${last}`);
  }
  return { ok: false, error: last };
}
