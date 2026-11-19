'use client';

import { useEffect, type RefObject } from 'react';
import { Marker, type MapRef } from 'react-map-gl/maplibre';

/**
 * Marker of the elevation profile cursor on the map (#1391): contrasted dot with a halo, shared by the
 * track sheet, the outings and the editor. If the point leaves the view, the map recentres on it (without animation
 * under `prefers-reduced-motion`).
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
      <span aria-hidden className="block size-5 rounded-full border-[3px] border-card bg-foreground shadow-md ring-4 ring-foreground/20" />
    </Marker>
  );
}
