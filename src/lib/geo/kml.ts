import { inflateRawSync } from 'node:zlib';
import tokens from '../../../design/tokens.json';
import type { Position, TrackGeometry } from './types';
import { parseGpxFile, type GpxFile, type GpxTrack } from './gpx';

/** Cap on the KML after decompressing a KMZ (anti "zip bomb"). */
export const MAX_KML_BYTES = 20 * 1024 * 1024;

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Text of an element (CDATA lifted); the KML description is often HTML: its text is kept. */
function text(block: string, tag: string, html = false): string | null {
  const raw = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(block)?.[1]?.trim();
  if (!raw) return null;
  let v = raw.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1');
  if (html) v = decode(v).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
  else v = decode(v);
  return v.trim() || null;
}

/** `lon,lat[,alt]` separated by spaces or line breaks. */
function coordinates(s: string): Position[] {
  const out: Position[] = [];
  for (const tuple of s.trim().split(/\s+/)) {
    const [lon, lat, alt] = tuple.split(',').map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push(alt !== undefined && Number.isFinite(alt) ? [lon, lat, alt] : [lon, lat]);
  }
  return out;
}

/** `<gx:coord>lon lat alt</gx:coord>` (one point per element). */
function gxCoords(block: string): Position[] {
  const out: Position[] = [];
  const re = /<gx:coord>\s*([^<]*?)\s*<\/gx:coord>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const [lon, lat, alt] = m[1].split(/\s+/).map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push(alt !== undefined && Number.isFinite(alt) ? [lon, lat, alt] : [lon, lat]);
  }
  return out;
}

/** Google My Maps writes a 0 elevation everywhere: that is not an elevation, IGN will fill it. */
function dropFlatZero(lines: Position[][]): Position[][] {
  const all = lines.flat();
  if (all.length > 0 && all.every((p) => p[2] === 0)) return lines.map((l) => l.map((p) => [p[0], p[1]] as Position));
  return lines;
}

/**
 * Reads a KML: one entry per `Placemark` carrying a line (`LineString`, `gx:Track`, `MultiGeometry` /
 * `gx:MultiTrack` → MultiLineString). Points, polygons and folders without a line are ignored.
 * Rejects DOCTYPE/ENTITY. Same return shape as `parseGpxFile`.
 */
export function parseKmlFile(xml: string): GpxFile {
  if (!/<kml\b/.test(xml)) throw new Error('notGpx');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('doctype');
  const tracks: GpxTrack[] = [];
  const re = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const body = m[1];
    const lines: Position[][] = [];
    const ls = /<LineString\b[^>]*>([\s\S]*?)<\/LineString>/g;
    let l: RegExpExecArray | null;
    while ((l = ls.exec(body))) {
      const c = /<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/.exec(l[1])?.[1];
      if (c) lines.push(coordinates(c));
    }
    const gt = /<gx:Track\b[^>]*>([\s\S]*?)<\/gx:Track>/g;
    while ((l = gt.exec(body))) lines.push(gxCoords(l[1]));
    const ne = dropFlatZero(lines.filter((x) => x.length >= 2));
    if (ne.length === 0) continue;
    const head = body.replace(/<(?:LineString|MultiGeometry|gx:Track|gx:MultiTrack|Point|Polygon)\b[\s\S]*$/, '');
    tracks.push({
      name: text(head, 'name'),
      description: text(head, 'description', true),
      geometry: ne.length === 1 ? { type: 'LineString', coordinates: ne[0] } : { type: 'MultiLineString', coordinates: ne },
    });
  }
  if (tracks.length === 0) throw new Error('noTrack');
  const link = /<atom:link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/.exec(xml)?.[1] ?? null;
  const author = /<atom:author>\s*<atom:name>([\s\S]*?)<\/atom:name>/.exec(xml)?.[1];
  return { creator: null, author: author ? decode(author.trim()) : null, link, tracks };
}

/**
 * Extracts the KML from a KMZ (zip): `doc.kml` preferably, otherwise the first `.kml`. Minimal reader (central
 * directory + raw inflate), no dependency; encryption and methods other than "stored / deflate" refused.
 */
export function kmlFromKmz(buf: Buffer): string {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || buf.length < eocd + 22) throw new Error('unreadable');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: { name: string; method: number; csize: number; usize: number; offset: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('unreadable');
    const flags = buf.readUInt16LE(p + 8);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    if (flags & 1) throw new Error('unreadable');
    entries.push({
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      csize: buf.readUInt32LE(p + 20),
      usize: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const kmls = entries.filter((e) => /\.kml$/i.test(e.name) && !/(^|\/)\.\./.test(e.name));
  const e = kmls.find((x) => /^doc\.kml$/i.test(x.name)) ?? kmls[0];
  if (!e) throw new Error('noTrack');
  if (e.usize > MAX_KML_BYTES) throw new Error('tooBig');
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error('unreadable');
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.csize);
  if (e.method === 0) return data.toString('utf8');
  if (e.method !== 8) throw new Error('unreadable');
  try {
    return inflateRawSync(data, { maxOutputLength: MAX_KML_BYTES }).toString('utf8');
  } catch {
    throw new Error('tooBig');
  }
}

/** KML colour `aabbggrr` from a `#rrggbb` token. */
const kmlColor = (hex: string) => `ff${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;

/**
 * Writes a KML 2.2: one `Placemark` / `LineString` (MultiGeometry for several lines), elevation included when it exists
 * (`clampToGround` otherwise). No `gx:Track`: our tracks have no timestamps. Attribution and licence
 * stay in `description` (licence obligation).
 */
export function toKml(t: { name: string; description?: string | null; attribution?: string | null; license?: string | null; geometry: TrackGeometry }): string {
  const lines = t.geometry.type === 'LineString' ? [t.geometry.coordinates] : t.geometry.coordinates;
  const desc = [t.description, t.attribution, t.license ? `Licence : ${t.license}` : null].filter(Boolean).join('\n');
  const hasAlt = lines.some((l) => l.some((p) => typeof p[2] === 'number'));
  const mode = hasAlt ? 'absolute' : 'clampToGround';
  const ls = lines
    .map(
      (l) =>
        `<LineString><tessellate>1</tessellate><altitudeMode>${mode}</altitudeMode><coordinates>${l
          .map((p) => (hasAlt ? `${p[0]},${p[1]},${typeof p[2] === 'number' ? p[2] : 0}` : `${p[0]},${p[1]}`))
          .join(' ')}</coordinates></LineString>`,
    )
    .join('');
  const color = kmlColor(tokens.color.find((c) => c.name === 'primary')!.value.light);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(t.name)}</name><Style id="trace"><LineStyle><color>${color}</color><width>4</width></LineStyle></Style><Placemark><name>${esc(t.name)}</name>${desc ? `<description>${esc(desc)}</description>` : ''}<styleUrl>#trace</styleUrl>${lines.length === 1 ? ls : `<MultiGeometry>${ls}</MultiGeometry>`}</Placemark></Document></kml>\n`;
}

/** Track file (GPX, KML or KMZ) read according to its extension. */
export function parseTrackFile(name: string, bytes: Buffer): GpxFile {
  if (/\.gpx$/i.test(name)) return parseGpxFile(bytes.toString('utf8'));
  if (/\.kml$/i.test(name)) return parseKmlFile(bytes.toString('utf8'));
  if (/\.kmz$/i.test(name)) return parseKmlFile(kmlFromKmz(bytes));
  throw new Error('notGpxExt');
}
