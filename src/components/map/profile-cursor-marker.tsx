'use client';

import { useEffect, type RefObject } from 'react';
import { Marker, type MapRef } from 'react-map-gl/maplibre';

/**
 * Marqueur du curseur du profil altimétrique sur la carte (#1391) : point contrasté avec halo, partagé par la
 * fiche trace, les sorties et l'éditeur. Si le point sort de la vue, la carte s'y recentre (sans animation
 * si `prefers-reduced-motion`).
 */
export function ProfileCursorMarker({ mapRef, lon, lat }: { mapRef: RefObject<MapRef | null>; lon: number; lat: number }) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || map.getBounds().contains([lon, lat])) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.panTo([lon, lat], { duration: reduce ? 0 : 200 });
  }, [mapRef, lon, lat]);

  return (
    <Marker longitude={lon} latitude={lat} style={{ pointerEvents: 'none' }}>
      <span aria-hidden className="block size-5 rounded-full border-4 border-card bg-foreground shadow-md ring-4 ring-foreground/25" />
    </Marker>
  );
}
