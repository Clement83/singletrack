import type { StyleSpecification } from 'maplibre-gl';
import { DEM_SOURCE, DEM_SOURCE_ID } from './terrain';

// OpenTopoMap topo basemap (free fallback). IGN Géoplateforme is still to be assessed (licence, quotas): see AGENTS.md.
export const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    topo: {
      type: 'raster',
      tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 17,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    },
  },
  layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
};

/** Same basemap + elevation source (#1667): only loaded when 3D is on. */
export const BASE_STYLE_WITH_DEM: StyleSpecification = { ...BASE_STYLE, sources: { ...BASE_STYLE.sources, [DEM_SOURCE_ID]: DEM_SOURCE } };

/** Plain-text credits of the basemap and relief, drawn on exported videos (#1707). */
export const BASE_CREDITS = '© OpenStreetMap · OpenTopoMap (CC-BY-SA) · Mapzen Terrain Tiles';
