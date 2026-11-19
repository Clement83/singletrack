import { config } from '@/lib/config';
import type { RegionConfig } from './types';

/** Base region of the syncs (the area code is set by `SYNC_ZONES` / the arguments), centred on home. */
export function regionFromConfig(): RegionConfig {
  return {
    code: config.syncZones[0] ?? '',
    center: { lat: config.homeLat, lon: config.homeLon },
    bbox: { minLon: 5.7, minLat: 42.9, maxLon: 7.0, maxLat: 43.8 },
  };
}
