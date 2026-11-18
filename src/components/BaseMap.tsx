'use client';

import Map, { GeolocateControl, NavigationControl, type MapProps, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { StyleSpecification } from 'maplibre-gl';
import { cn } from '@/lib/utils';

// Fond topo OpenTopoMap (secours libre). L'IGN Géoplateforme est à évaluer (licence, quotas) : voir AGENTS.md.
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

type Props = {
  lat: number;
  lon: number;
  zoom?: number;
  /**
   * Carte intégrée dans une page qui défile (fiche trace, sortie) : un doigt fait défiler la page,
   * deux doigts déplacent la carte (cooperativeGestures) — la carte ne « piège » pas le doigt.
   * Carte plein écran (accueil) : laisser à `false`.
   */
  embedded?: boolean;
  /** `false` : carte figée (aperçu dans une page qui défile, #1621) — ni geste ni bouton, le doigt fait défiler la page. */
  interactive?: boolean;
  className?: string;
  /** Calques / marqueurs react-map-gl posés sur la carte. */
  children?: React.ReactNode;
  mapRef?: React.Ref<MapRef>;
  /** Emprise initiale (prioritaire sur lat/lon/zoom). */
  bounds?: [number, number, number, number];
  boundsPadding?: number | { top: number; bottom: number; left: number; right: number };
} & Pick<MapProps, 'onClick' | 'onMouseMove' | 'onMouseLeave' | 'onMouseDown' | 'onMouseUp' | 'onContextMenu' | 'onMoveEnd' | 'onLoad' | 'interactiveLayerIds' | 'cursor'>;

/**
 * Carte de base, tactile : pinch-zoom, rotation à deux doigts, boutons ≥ 44 px (cf. `.map-touch`
 * dans globals.css), bouton « me localiser » (géolocalisation live).
 * La géolocalisation exige HTTPS (ou localhost) : sur le LAN en HTTP le navigateur la refuse, le
 * bouton affiche alors une erreur sobre — voir AGENTS.md.
 */
export default function BaseMap({ lat, lon, zoom = 11, embedded = false, interactive = true, className, children, mapRef, bounds, boundsPadding = 40, ...events }: Props) {
  return (
    <div className={cn('map-touch size-full', className)}>
    <Map
      ref={mapRef}
      {...events}
      initialViewState={
        bounds ? { bounds, fitBoundsOptions: { padding: boundsPadding } } : { latitude: lat, longitude: lon, zoom }
      }
      mapStyle={style}
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
      {children}
    </Map>
    </div>
  );
}
