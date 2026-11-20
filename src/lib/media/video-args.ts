import type { VideoProbe } from './ffmpeg';

/** Published video (#1693): long side ≤ 1280 px (720p), ≤ 30 fps, H.264 + AAC, `+faststart`. */
export const VIDEO_LONG_PX = 1280;
export const VIDEO_MAX_FPS = 30;
export const VIDEO_BITRATE = '3M';
export const VIDEO_MAXRATE = '4M';
export const THUMB_PX = 480;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output size for a `w`×`h` source: long side ≤ `long`, never enlarged, even sides. */
export function fitSize(w: number, h: number, long = VIDEO_LONG_PX): { w: number; h: number } {
  const k = Math.min(1, long / Math.max(w, h));
  return { w: even(w * k), h: even(h * k) };
}

/** `vpp_qsv` transpose for a display rotation: GPU frames are not auto-rotated by ffmpeg. */
export function qsvTranspose(rotation: number): string | null {
  switch (rotation) {
    case 90: return 'cclock';
    case 180: return 'reversal';
    case 270: return 'clock';
    default: return null;
  }
}

/** Output options shared by both encoders: audio, metadata stripped (time, position, device), web-ready MP4. */
function common(p: VideoProbe, output: string): string[] {
  return [
    ...(p.hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an']),
    '-sn', '-dn',
    // Nothing from the original is copied: no global/stream/chapter metadata (creation_time, ISO6709 location, device).
    '-map_metadata', '-1', '-map_metadata:s:v', '-1', '-map_metadata:s:a', '-1', '-map_chapters', '-1',
    '-fpsmax', String(VIDEO_MAX_FPS),
    '-movflags', '+faststart',
    '-f', 'mp4', output,
  ];
}

/** Software encoding (libx264): ffmpeg auto-rotates, 8-bit 4:2:0 (HEVC 10-bit and HDR sources included). */
export function x264Args(input: string, output: string, p: VideoProbe): string[] {
  const { w, h } = fitSize(p.displayWidth, p.displayHeight);
  return [
    '-hide_banner', '-nostdin', '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `scale=${w}:${h},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', VIDEO_MAXRATE, '-bufsize', '8M',
    '-profile:v', 'high', '-level', '4.0',
    // ffmpeg ≥ 7 writes the rotation as side data; the picture is already rotated, so none is written.
    ...common(p, output),
  ];
}

/**
 * Intel iGPU (QSV): hardware decoding when the codec allows it, scaling + rotation by `vpp_qsv` (size in the
 * STORED orientation: vpp_qsv scales before transposing), `h264_qsv` encoding. Same output as x264.
 */
export function qsvArgs(input: string, output: string, p: VideoProbe, device = 'qsv=hw'): string[] {
  const { w, h } = fitSize(p.width, p.height);
  const t = qsvTranspose(p.rotation);
  return [
    '-hide_banner', '-nostdin', '-y',
    '-init_hw_device', device, '-filter_hw_device', 'hw',
    '-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv',
    '-noautorotate', '-display_rotation', '0',
    '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `vpp_qsv=${t ? `transpose=${t}:` : ''}w=${w}:h=${h}:format=nv12`,
    '-c:v', 'h264_qsv', '-preset', 'medium', '-b:v', VIDEO_BITRATE, '-maxrate', VIDEO_MAXRATE, '-bufsize', '8M',
    // h264_qsv does not accept "4.0" (silently lowered to 3.1).
    '-profile:v', 'high', '-level', '40',
    ...common(p, output),
  ];
}

/** Square JPEG thumbnail (cover) from the published MP4: `thumbnail` picks a representative (sharp) frame among the first ones. */
export function thumbArgs(input: string, output: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-y', '-i', input,
    '-vf', `thumbnail=n=24,scale=${THUMB_PX}:${THUMB_PX}:force_original_aspect_ratio=increase,crop=${THUMB_PX}:${THUMB_PX}`,
    '-frames:v', '1', '-q:v', '4', '-map_metadata', '-1', '-f', 'image2', output,
  ];
}
