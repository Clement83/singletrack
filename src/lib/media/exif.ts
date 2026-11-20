/**
 * Minimal reading of the GPS in a JPEG's EXIF (#1413). Pure, no dependency: used in the browser
 * (canvas compression strips EXIF, so the position is read BEFORE) and on the server (fallback).
 * Only the position and the capture time (`DateTimeOriginal`, `OffsetTimeOriginal`, #1692) are read:
 * no camera, no serial number.
 */
export type GpsPos = { lat: number; lon: number };

export function readExifGps(buf: Uint8Array): GpsPos | null {
  try {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      if (v.getUint8(off) !== 0xff) return null;
      const marker = v.getUint8(off + 1);
      if (marker === 0xda || marker === 0xd9) return null;
      const len = v.getUint16(off + 2);
      if (marker === 0xe1 && v.getUint32(off + 4) === 0x45786966 /* Exif */) return fromTiff(v, off + 10, off + 2 + len);
      off += 2 + len;
    }
  } catch {
    /* truncated or unreadable file: no position */
  }
  return null;
}

function fromTiff(v: DataView, base: number, end: number): GpsPos | null {
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o: number) => v.getUint16(base + o, le);
  const u32 = (o: number) => v.getUint32(base + o, le);
  if (u16(2) !== 42) return null;
  const entries = (ifd: number) => {
    const n = u16(ifd);
    const out = new Map<number, number>();
    for (let i = 0; i < n && base + ifd + 2 + i * 12 + 12 <= end; i++) out.set(u16(ifd + 2 + i * 12), ifd + 2 + i * 12);
    return out;
  };
  const gpsPtr = entries(u32(4)).get(0x8825);
  if (gpsPtr === undefined) return null;
  const gps = entries(u32(gpsPtr + 8));
  const ascii = (e: number | undefined) => (e === undefined ? '' : String.fromCharCode(v.getUint8(base + e + 8)));
  const dms = (e: number | undefined) => {
    if (e === undefined) return null;
    const at = u32(e + 8);
    const r = (i: number) => {
      const d = u32(at + i * 8 + 4);
      return d === 0 ? NaN : u32(at + i * 8) / d;
    };
    const val = r(0) + r(1) / 60 + r(2) / 3600;
    return Number.isFinite(val) ? val : null;
  };
  const lat = dms(gps.get(2));
  const lon = dms(gps.get(4));
  if (lat == null || lon == null) return null;
  const pos = { lat: ascii(gps.get(1)) === 'S' ? -lat : lat, lon: ascii(gps.get(3)) === 'W' ? -lon : lon };
  return validPos(pos.lat, pos.lon) && !(pos.lat === 0 && pos.lon === 0) ? pos : null;
}

export function validPos(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/** Capture time as written in EXIF: local `YYYY-MM-DDTHH:mm:ss` (no zone) and the optional `+HH:MM` offset. */
export type ExifDate = { local: string; offset: string | null };

/** Reads `DateTimeOriginal` (+ `OffsetTimeOriginal`) of a JPEG; `null` if absent or unreadable. */
export function readExifDate(buf: Uint8Array): ExifDate | null {
  try {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      if (v.getUint8(off) !== 0xff) return null;
      const marker = v.getUint8(off + 1);
      if (marker === 0xda || marker === 0xd9) return null;
      const len = v.getUint16(off + 2);
      if (marker === 0xe1 && v.getUint32(off + 4) === 0x45786966) return dateFromTiff(v, off + 10, off + 2 + len);
      off += 2 + len;
    }
  } catch {
    /* truncated or unreadable file: no date */
  }
  return null;
}

function dateFromTiff(v: DataView, base: number, end: number): ExifDate | null {
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o: number) => v.getUint16(base + o, le);
  const u32 = (o: number) => v.getUint32(base + o, le);
  if (u16(2) !== 42) return null;
  const entries = (ifd: number) => {
    const n = u16(ifd);
    const out = new Map<number, number>();
    for (let i = 0; i < n && base + ifd + 2 + i * 12 + 12 <= end; i++) out.set(u16(ifd + 2 + i * 12), ifd + 2 + i * 12);
    return out;
  };
  const ptr = entries(u32(4)).get(0x8769);
  if (ptr === undefined) return null;
  const exif = entries(u32(ptr + 8));
  const ascii = (e: number | undefined) => {
    if (e === undefined) return null;
    const count = u32(e + 4);
    const at = count > 4 ? u32(e + 8) : e + 8;
    if (count < 1 || count > 64 || base + at + count > end) return null;
    let s = '';
    for (let i = 0; i < count; i++) {
      const c = v.getUint8(base + at + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(ascii(exif.get(0x9003)) ?? '');
  if (!m) return null;
  const off = ascii(exif.get(0x9011));
  return { local: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, offset: off && /^[+-]\d{2}:\d{2}$/.test(off) ? off : null };
}
