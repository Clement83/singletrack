import type { Position, TrackGeometry } from './types';

/**
 * Minimal GPX reading: `<trk>`/`<trkseg>`/`<trkpt>` (otherwise `<rte>`/`<rtept>`).
 * No XML dependency: the lat/lon attributes and the <ele> element are enough.
 */
export function parseGpx(xml: string): { name: string | null; geometry: TrackGeometry } {
  const name = /<(?:trk|rte)>\s*(?:[\s\S]*?)<name>([\s\S]*?)<\/name>/.exec(xml)?.[1]?.trim() ?? null;
  const segs: Position[][] = [];
  const segRe = /<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/g;
  let m: RegExpExecArray | null;
  while ((m = segRe.exec(xml))) segs.push(points(m[1], 'trkpt'));
  if (segs.length === 0) {
    const rte = /<rte\b[^>]*>([\s\S]*?)<\/rte>/g;
    while ((m = rte.exec(xml))) segs.push(points(m[1], 'rtept'));
  }
  const nonEmpty = segs.filter((s) => s.length > 0);
  if (nonEmpty.length === 0) throw new Error('noPoints');
  const geometry: TrackGeometry =
    nonEmpty.length === 1
      ? { type: 'LineString', coordinates: nonEmpty[0] }
      : { type: 'MultiLineString', coordinates: nonEmpty };
  return { name: name ? decode(name) : null, geometry };
}

function points(block: string, tag: string): Position[] {
  const out: Position[] = [];
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const lat = /\blat\s*=\s*["']([^"']+)["']/.exec(m[1])?.[1];
    const lon = /\blon\s*=\s*["']([^"']+)["']/.exec(m[1])?.[1];
    if (lat === undefined || lon === undefined) continue;
    const ele = m[2] ? /<ele>\s*([^<\s]+)\s*<\/ele>/.exec(m[2])?.[1] : undefined;
    const p: Position = ele !== undefined && !Number.isNaN(Number(ele)) ? [Number(lon), Number(lat), Number(ele)] : [Number(lon), Number(lat)];
    out.push(p);
  }
  return out;
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Writes a GPX 1.1 (one `<trk>`, one `<trkseg>` per line); the attribution is kept in `<desc>`. */
export function toGpx(t: { name: string; description?: string | null; attribution?: string | null; geometry: TrackGeometry }): string {
  const segs = t.geometry.type === 'LineString' ? [t.geometry.coordinates] : t.geometry.coordinates;
  const desc = [t.description, t.attribution].filter(Boolean).join(' — ');
  const body = segs
    .map(
      (s) =>
        `<trkseg>${s
          .map((p) => `<trkpt lat="${p[1]}" lon="${p[0]}">${typeof p[2] === 'number' ? `<ele>${p[2]}</ele>` : ''}</trkpt>`)
          .join('')}</trkseg>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="singletrack" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${esc(t.name)}</name>${desc ? `<desc>${esc(desc)}</desc>` : ''}</metadata><trk><name>${esc(t.name)}</name>${body}</trk></gpx>\n`;
}

export type GpxTrack = { name: string | null; description: string | null; geometry: TrackGeometry };
export type GpxFile = { creator: string | null; author: string | null; link: string | null; tracks: GpxTrack[] };

const inner = (block: string, tag: string) => {
  const v = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(block)?.[1]?.trim();
  if (!v) return null;
  return decode(v.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')) || null;
};

/**
 * Reads a full GPX: one entry per `<trk>` (its `<trkseg>`s form a MultiLineString),
 * otherwise per `<rte>`. Rejects DOCTYPE/ENTITY (no external entity is resolved anyway).
 */
export function parseGpxFile(xml: string): GpxFile {
  if (!/<gpx\b/.test(xml)) throw new Error('notGpx');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('doctype');
  const meta = /<metadata\b[^>]*>([\s\S]*?)<\/metadata>/.exec(xml)?.[1] ?? '';
  const creator = /<gpx\b[^>]*\bcreator\s*=\s*["']([^"']*)["']/.exec(xml)?.[1] ?? null;
  const author = inner(/<author\b[^>]*>([\s\S]*?)<\/author>/.exec(meta)?.[1] ?? '', 'name');
  const link = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/.exec(meta)?.[1] ?? null;
  const tracks: GpxTrack[] = [];
  const collect = (tag: 'trk' | 'rte', seg: string, pt: string) => {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const body = m[1];
      const segs: Position[][] = [];
      if (seg) {
        const sr = new RegExp(`<${seg}\\b[^>]*>([\\s\\S]*?)</${seg}>`, 'g');
        let s: RegExpExecArray | null;
        while ((s = sr.exec(body))) segs.push(points(s[1], pt));
      } else segs.push(points(body, pt));
      const ne = segs.filter((s) => s.length >= 2);
      if (ne.length === 0) continue;
      const head = body.replace(/<(trkseg|trkpt|rtept)\b[\s\S]*$/, '');
      tracks.push({
        name: inner(head, 'name'),
        description: inner(head, 'desc') ?? inner(head, 'cmt'),
        geometry: ne.length === 1 ? { type: 'LineString', coordinates: ne[0] } : { type: 'MultiLineString', coordinates: ne },
      });
    }
  };
  collect('trk', 'trkseg', 'trkpt');
  if (tracks.length === 0) collect('rte', '', 'rtept');
  if (tracks.length === 0) throw new Error('noTrack');
  return { creator, author, link, tracks };
}
