import { kmAlongTrack } from './along';
import { haversine } from './distance';
import type { Position, TrackGeometry } from './types';
import { RIDE_PRIVACY_M } from './trim-ends';

/** A key moment noted during a ride (#1798): GPX `<wpt>` or KML `Placemark` Point. `at` = epoch ms, `null` if undated. */
export type Moment = { lat: number; lon: number; at: number | null; name: string | null; type: string | null };

/** At most this many moments are kept per ride. */
export const MAX_MOMENTS = 200;

const decode = (s: string) =>
  s
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

const clean = (s: string | undefined | null, max: number): string | null => {
  if (!s) return null;
  const v = decode(s.trim()).replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, max) : null;
};
const tag = (block: string, name: string) => new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(block)?.[1];
const time = (s: string | undefined): number | null => {
  if (!s) return null;
  const ms = Date.parse(s.trim());
  return Number.isNaN(ms) ? null : ms;
};
const valid = (lon: number, lat: number) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** GPX `<wpt>` with their `<time>`, `<name>` and `<type>`. */
export function gpxMoments(xml: string): Moment[] {
  const out: Moment[] = [];
  const re = /<wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/wpt>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < MAX_MOMENTS) {
    const lat = Number(/\blat\s*=\s*["']([^"']+)["']/.exec(m[1])?.[1]);
    const lon = Number(/\blon\s*=\s*["']([^"']+)["']/.exec(m[1])?.[1]);
    if (!valid(lon, lat)) continue;
    const body = m[2] ?? '';
    out.push({ lat, lon, at: time(tag(body, 'time')), name: clean(tag(body, 'name'), 120), type: clean(tag(body, 'type'), 40) });
  }
  return out;
}

/** KML `Placemark` carrying a Point and no line: `TimeStamp/when`, or `TimeSpan/begin`, and its `name`. */
export function kmlMoments(xml: string): Moment[] {
  const out: Moment[] = [];
  const re = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < MAX_MOMENTS) {
    const body = m[1];
    if (/<(?:LineString|gx:Track|gx:MultiTrack|Polygon)\b/.test(body)) continue;
    const c = /<Point\b[^>]*>[\s\S]*?<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/.exec(body)?.[1];
    if (!c) continue;
    const [lon, lat] = c.trim().split(',').map(Number);
    if (!valid(lon, lat)) continue;
    const stamp = /<TimeStamp\b[^>]*>([\s\S]*?)<\/TimeStamp>/.exec(body)?.[1];
    const span = /<TimeSpan\b[^>]*>([\s\S]*?)<\/TimeSpan>/.exec(body)?.[1];
    const head = body.replace(/<Point\b[\s\S]*$/, '');
    out.push({
      lat, lon,
      at: time(stamp ? tag(stamp, 'when') : span ? tag(span, 'begin') : undefined),
      name: clean(tag(head, 'name'), 120),
      type: null,
    });
  }
  return out;
}

/**
 * Moments the viewer may see on someone else's ride (#1772): the first and last `RIDE_PRIVACY_M` metres of the track are
 * hidden, so a moment whose closest point on the (whole) track falls there — on any pass — is dropped.
 */
export function visibleMoments<T extends { lat: number; lon: number }>(moments: T[], whole: TrackGeometry | Position[], m = RIDE_PRIVACY_M): T[] {
  const pts = Array.isArray(whole) ? whole : whole.type === 'LineString' ? whole.coordinates : whole.coordinates.flat();
  const total = pts.slice(1).reduce((acc, p, i) => acc + haversine(pts[i], p), 0);
  if (!(total > 2 * m)) return [];
  return moments.filter((mo) => {
    const r = kmAlongTrack(pts, mo.lon, mo.lat);
    return !!r && r.kms.every((km) => km * 1000 >= m && km * 1000 <= total - m);
  });
}
