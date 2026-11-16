import { config } from '@/lib/config';
import type { RegionConfig } from './types';

/** Région de base des synchros (le code de zone est fixé par `SYNC_ZONES` / les arguments), centrée sur la maison. */
export function regionFromConfig(): RegionConfig {
  return {
    code: config.syncZones[0] ?? '',
    center: { lat: config.homeLat, lon: config.homeLon },
    bbox: { minLon: 5.7, minLat: 42.9, maxLon: 7.0, maxLat: 43.8 },
  };
}
