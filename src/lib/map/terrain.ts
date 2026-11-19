import type { RasterDEMSourceSpecification, TerrainSpecification } from 'maplibre-gl';

/**
 * Relief en 3D (#1667, epic #1666) : tuiles d'altitude Terrarium d'AWS Open Data (gratuites, sans clé,
 * ~30 m en France, SRTM). Même format que des tuiles IGN générées plus tard : seule l'URL changerait.
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

/** Relief un peu accentué : les collines du Var restent lisibles sans paraître caricaturales. */
export const TERRAIN_EXAGGERATION = 1.5;

export const TERRAIN: TerrainSpecification = { source: DEM_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION };

/** Inclinaison donnée à l'activation (à plat = 0 à la désactivation). */
export const TERRAIN_PITCH = 60;

/** Inclinaison cible quand on bascule la 3D. */
export function terrainPitch(on: boolean): number {
  return on ? TERRAIN_PITCH : 0;
}

/** Tuile d'altitude (service worker : mise en cache comme le fond de carte). */
export function isDemTileUrl(url: URL): boolean {
  return url.hostname === 's3.amazonaws.com' && url.pathname.startsWith('/elevation-tiles-prod/terrarium/');
}
