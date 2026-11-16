import { lines, profileOf } from '@/lib/geo';
import type { TrackGeometry } from '@/lib/geo/types';

/** Profil échantillonné (~240 points) + position, au format attendu par `TrackDetail`. */
export function profileFor(geometry: TrackGeometry, target = 240) {
  const coords = lines(geometry).flat();
  const full = profileOf(coords);
  const withEle = coords.filter((p) => typeof p[2] === 'number');
  const step = Math.max(1, Math.floor(full.length / target));
  return full
    .map((p, i) => ({ ...p, lon: withEle[i][0], lat: withEle[i][1] }))
    .filter((_, i, a) => i % step === 0 || i === a.length - 1);
}
