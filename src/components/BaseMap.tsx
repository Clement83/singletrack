'use client';

import Map, { GeolocateControl, NavigationControl, type MapProps, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { StyleSpecification } from 'maplibre-gl';
import { cn } from '@/lib/utils';
import { DEM_SOURCE, DEM_SOURCE_ID } from '@/lib/map/terrain';
import { TerrainToggle } from '@/components/map/terrain-toggle';

// OpenTopoMap topo basemap (free fallback). IGN Géoplateforme is still to be assessed (licence, quotas): see AGENTS.md.
const style: StyleSpecification = {
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
const styleWithDem: StyleSpecification = { ...style, sources: { ...style.sources, [DEM_SOURCE_ID]: DEM_SOURCE } };

type Props = {
  lat: number;
  lon: number;
  zoom?: number;
  /**
   * Map embedded in a scrolling page (track sheet, outing): one finger scrolls the page,
   * two fingers move the map (cooperativeGestures) — the map does not "trap" the finger.
   * Full-screen map (home): leave `false`.
   */
  embedded?: boolean;
  /** `false`: frozen map (preview in a scrolling page, #1621) — no gesture or button, the finger scrolls the page. */
  interactive?: boolean;
  className?: string;
  /** react-map-gl layers / markers placed on the map. */
  children?: React.ReactNode;
  mapRef?: React.Ref<MapRef>;
  /** Emprise initiale (prioritaire sur lat/lon/zoom). */
  bounds?: [number, number, number, number];
  boundsPadding?: number | { top: number; bottom: number; left: number; right: number };
  /** 3D relief available (#1667): "3D" button in the controls (interactive map only). */
  terrain?: boolean;
} & Pick<MapProps, 'onClick' | 'onMouseMove' | 'onMouseLeave' | 'onMouseDown' | 'onMouseUp' | 'onContextMenu' | 'onMoveEnd' | 'onLoad' | 'interactiveLayerIds' | 'cursor'>;

/**
 * Base map, touch-friendly: pinch zoom, two-finger rotation, buttons ≥ 44 px (see `.map-touch`
 * in globals.css), "locate me" button (live geolocation).
 * Geolocation requires HTTPS (or localhost): over plain HTTP on the LAN the browser refuses it, the
 * button then shows a plain error — see AGENTS.md.
 */
export default function BaseMap({ lat, lon, zoom = 11, embedded = false, interactive = true, className, children, mapRef, bounds, boundsPadding = 40, terrain = false, ...events }: Props) {
  return (
    <div className={cn('map-touch size-full', className)}>
    <Map
      ref={mapRef}
      {...events}
      initialViewState={
        bounds ? { bounds, fitBoundsOptions: { padding: boundsPadding } } : { latitude: lat, longitude: lon, zoom }
      }
      mapStyle={terrain ? styleWithDem : style}
      interactive={interactive}
      cooperativeGestures={embedded}
      style={{ width: '100%', height: '100%' }}
    >
      {interactive && <NavigationControl position="top-right" showCompass visualizePitch={false} />}
      {interactive && <GeolocateControl
        position="top-right"
        trackUserLocation
        showUserLocation
        showAccuracyCircle
        positionOptions={{ enableHighAccuracy: true }}
      />}
      {interactive && terrain && <TerrainToggle />}
      {children}
    </Map>
    </div>
  );
}
