import type { RasterDEMSourceSpecification, TerrainSpecification } from 'maplibre-gl';

/**
 * 3D relief (#1667, epic #1666): Terrarium elevation tiles from AWS Open Data (free, no key,
 * ~30 m in France, SRTM). Same format as IGN tiles generated later: only the URL would change.
 */
export const DEM_SOURCE_ID = 'dem';

export const DEM_SOURCE: RasterDEMSourceSpecification = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 15,
  attribution:
    '<a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a> (AWS Open Data, SRTM…)',
};

/** Slightly exaggerated relief: the Var hills stay readable without looking cartoonish. */
export const TERRAIN_EXAGGERATION = 1.5;

export const TERRAIN: TerrainSpecification = { source: DEM_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION };

/** Pitch given on activation (flat = 0 on deactivation). */
export const TERRAIN_PITCH = 60;

/** Target pitch when toggling 3D. */
export function terrainPitch(on: boolean): number {
  return on ? TERRAIN_PITCH : 0;
}

/** Elevation tile (service worker: cached like the basemap). */
export function isDemTileUrl(url: URL): boolean {
  return url.hostname === 's3.amazonaws.com' && url.pathname.startsWith('/elevation-tiles-prod/terrarium/');
}
