import type { PhotoView } from './photos';
import type { VideoView } from './videos';

export type MediaPoint = { id: string; type: 'photo' | 'video'; lat: number; lon: number };

/**
 * Points of the outing photo map (#1702): located photos, then located **ready** videos (a pending or failed clip
 * cannot be opened yet).
 */
export function mediaPoints(photos: Pick<PhotoView, 'id' | 'pos'>[], videos: Pick<VideoView, 'id' | 'pos' | 'status'>[]): MediaPoint[] {
  return [
    ...photos.flatMap((p) => (p.pos ? [{ id: p.id, type: 'photo' as const, lat: p.pos.lat, lon: p.pos.lon }] : [])),
    ...videos.flatMap((v) => (v.pos && v.status === 'ready' ? [{ id: v.id, type: 'video' as const, lat: v.pos.lat, lon: v.pos.lon }] : [])),
  ];
}

/** `bbox` widened to every point. */
export function widenBbox(bbox: [number, number, number, number], points: { lat: number; lon: number }[]): [number, number, number, number] {
  return points.reduce<[number, number, number, number]>(
    (b, p) => [Math.min(b[0], p.lon), Math.min(b[1], p.lat), Math.max(b[2], p.lon), Math.max(b[3], p.lat)],
    [...bbox],
  );
}
