/**
 * Lecture minimale du GPS dans l'EXIF d'un JPEG (#1413). Pur, sans dépendance : utilisé côté navigateur
 * (la compression par canvas efface l'EXIF, on lit donc la position AVANT) et côté serveur (repli).
 * On ne lit RIEN d'autre (ni appareil, ni numéro de série, ni date).
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
    /* fichier tronqué ou illisible : pas de position */
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
