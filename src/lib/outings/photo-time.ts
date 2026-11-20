import { parisToUtc } from './time';

/**
 * Capture time of a photo (#1692) from the EXIF fields the browser read: `local` = `DateTimeOriginal`
 * (`YYYY-MM-DDTHH:mm:ss`, no zone) and `offset` = `OffsetTimeOriginal` (`+02:00`) if present.
 * Without an offset the camera's local time is taken as `Europe/Paris`. Returns epoch ms, `null` if invalid.
 */
export function resolveTakenAt(local: string | null | undefined, offset?: string | null): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec((local ?? '').trim());
  if (!m) return null;
  const off = offset?.trim();
  let ms: number;
  if (off && /^[+-]\d{2}:\d{2}$/.test(off)) ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${off}`);
  else {
    const d = parisToUtc(m[1], `${m[2]}:${m[3]}`);
    ms = d ? d.getTime() + Number(m[4]) * 1000 : NaN;
  }
  if (Number.isNaN(ms)) return null;
  const y = new Date(ms).getUTCFullYear();
  return y >= 2000 && y <= 2100 ? ms : null;
}
