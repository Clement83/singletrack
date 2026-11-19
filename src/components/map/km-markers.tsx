'use client';

import { useEffect, useMemo, useState } from 'react';
import { Marker, useMap } from 'react-map-gl/maplibre';
import { kmMarkers, kmStepForZoom } from '@/lib/geo/slopes';
import type { TrackGeometry } from '@/lib/geo/types';

/**
 * Pastilles kilométriques le long de la trace (#1382) : 1, 2, 3… de près, une sur 5 puis une sur 10 en dézoomant
 * (`kmStepForZoom`). Sous les points de l'éditeur (rendues avant eux), jamais cliquables : un tap dessus agit sur
 * la carte. Suit le sens de la trace (inverser renumérote). Le style de carte n'a pas de police (glyphs) :
 * marqueurs HTML, au plus quelques dizaines.
 */
export function KmMarkers({ geometry }: { geometry: TrackGeometry | null | undefined }) {
  const { current: map } = useMap();
  const [zoom, setZoom] = useState(() => map?.getZoom() ?? 12);
  useEffect(() => {
    if (!map) return;
    const sync = () => setZoom(map.getZoom());
    map.on('zoomend', sync);
    return () => {
      map.off('zoomend', sync);
    };
  }, [map]);
  const all = useMemo(() => (geometry ? kmMarkers(geometry, 1) : []), [geometry]);
  const step = kmStepForZoom(zoom);
  return all
    .filter((m) => Math.round(m.km) % step === 0)
    .map((m) => (
      <Marker key={m.km} longitude={m.position[0]} latitude={m.position[1]} style={{ pointerEvents: 'none' }}>
        <span
          aria-hidden
          className="flex h-5 min-w-5 items-center justify-center rounded-full border border-border bg-card px-1 text-caption leading-none font-semibold text-foreground tabular-nums shadow-sm"
        >
          {Math.round(m.km)}
        </span>
      </Marker>
    ));
}
