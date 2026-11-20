import { haversine } from './distance';
import type { Position } from './types';

/** A track point with its timestamp (epoch ms, `null` if the file gives none for it). */
export type TimedPoint = { p: Position; t: number | null };

const parseTime = (s: string | undefined): number | null => {
  if (!s) return null;
  const ms = Date.parse(s.trim());
  return Number.isNaN(ms) ? null : ms;
};

const validLonLat = (lon: number, lat: number) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** GPX points with their `<time>`, one array per `<trkseg>` (millisecond precision kept). */
export function gpxTimedSegments(xml: string): TimedPoint[][] {
  const segs: TimedPoint[][] = [];
  const segRe = /<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/g;
  let m: RegExpExecArray | null;
  while ((m = segRe.exec(xml))) {
    const seg: TimedPoint[] = [];
    const ptRe = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
    let q: RegExpExecArray | null;
    while ((q = ptRe.exec(m[1]))) {
      const lat = /\blat\s*=\s*["']([^"']+)["']/.exec(q[1])?.[1];
      const lon = /\blon\s*=\s*["']([^"']+)["']/.exec(q[1])?.[1];
      if (lat === undefined || lon === undefined || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon))) continue;
      const ele = q[2] ? /<ele>\s*([^<\s]+)\s*<\/ele>/.exec(q[2])?.[1] : undefined;
      const time = q[2] ? /<time>\s*([^<\s]+)\s*<\/time>/.exec(q[2])?.[1] : undefined;
      seg.push({
        p: ele !== undefined && !Number.isNaN(Number(ele)) ? [Number(lon), Number(lat), Number(ele)] : [Number(lon), Number(lat)],
        t: parseTime(time),
      });
    }
    if (seg.length) segs.push(seg);
  }
  return segs;
}

/**
 * KML points with their time, one array per line: `gx:Track` (`<when>` paired with each `<gx:coord>`), and
 * `LineString` of a Placemark carrying a `TimeSpan` (begin/end spread along the distance). A lone `TimeStamp`
 * gives no per-point time. Same Placemark/line order as `parseKmlFile`.
 */
export function kmlTimedSegments(xml: string): TimedPoint[][] {
  const out: TimedPoint[][] = [];
  const re = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const body = m[1];
    const ls = /<LineString\b[^>]*>([\s\S]*?)<\/LineString>/g;
    let l: RegExpExecArray | null;
    const span = /<TimeSpan\b[^>]*>([\s\S]*?)<\/TimeSpan>/.exec(body)?.[1];
    const begin = parseTime(span && /<begin>([^<]*)<\/begin>/.exec(span)?.[1]);
    const end = parseTime(span && /<end>([^<]*)<\/end>/.exec(span)?.[1]);
    while ((l = ls.exec(body))) {
      const c = /<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/.exec(l[1])?.[1];
      if (!c) continue;
      const pts: Position[] = [];
      for (const tuple of c.trim().split(/\s+/)) {
        const [lon, lat, alt] = tuple.split(',').map(Number);
        if (!validLonLat(lon, lat)) continue;
        pts.push(alt !== undefined && Number.isFinite(alt) ? [lon, lat, alt] : [lon, lat]);
      }
      let total = 0;
      const cum = pts.map((p, i) => (total += i ? haversine(pts[i - 1], p) : 0));
      const spread = begin != null && end != null && end > begin && total > 0;
      out.push(pts.map((p, i) => ({ p, t: spread ? begin + (end - begin) * (cum[i] / total) : null })));
    }
    const gt = /<gx:Track\b[^>]*>([\s\S]*?)<\/gx:Track>/g;
    while ((l = gt.exec(body))) {
      const whens = [...l[1].matchAll(/<when>\s*([^<]*?)\s*<\/when>/g)].map((x) => parseTime(x[1]));
      const seg: TimedPoint[] = [];
      let i = 0;
      for (const cm of l[1].matchAll(/<gx:coord>\s*([^<]*?)\s*<\/gx:coord>/g)) {
        const [lon, lat, alt] = cm[1].split(/\s+/).map(Number);
        const t = whens.length === 0 ? null : (whens[i] ?? null);
        i++;
        if (!validLonLat(lon, lat)) continue;
        seg.push({ p: alt !== undefined && Number.isFinite(alt) ? [lon, lat, alt] : [lon, lat], t });
      }
      out.push(seg);
    }
  }
  return out;
}
