'use client';

import Map, { GeolocateControl, NavigationControl, type MapProps, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cn } from '@/lib/utils';
import { BASE_STYLE, BASE_STYLE_WITH_DEM } from '@/lib/map/base-style';
import { TerrainToggle } from '@/components/map/terrain-toggle';

const style = BASE_STYLE;
const styleWithDem = BASE_STYLE_WITH_DEM;

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
