'use client';

import { Layer, Marker, Source } from 'react-map-gl/maplibre';
import { Camera } from 'lucide-react';
import { TrackTip, useTrackTip } from '@/components/map/track-tip';
import BaseMap from '@/components/BaseMap';
import { useMapColors } from '@/components/tracks/use-map-colors';
import type { TrackGeometry } from '@/lib/geo/types';

export type RideMapProps = {
  planned: TrackGeometry;
  ride: TrackGeometry | null;
  bbox: [number, number, number, number];
  /** Located photos (#1413): one chip ≥ 44 px per photo, a tap opens it. */
  photos?: { id: string; lat: number; lon: number }[];
  photoLabel?: string;
  onPhoto?: (id: string) => void;
};

/** Planned (dashed, discreet) under the actual ride (solid line): the gap shows immediately. */
export default function RideMapInner({ planned, ride, bbox, photos, photoLabel, onPhoto }: RideMapProps) {
  const colors = useMapColors();
  // "km from the start" tooltip (#1535), on the planned route as on the actual one.
  const { tip, onMove, onTap, clear } = useTrackTip((e) => {
    const id = e.features?.[0]?.layer.id;
    return id === 'ride-real-casing' && ride ? { geometry: ride } : id === 'ride-planned-casing' ? { geometry: planned } : null;
  });
  return (
    <BaseMap lat={(bbox[1] + bbox[3]) / 2} lon={(bbox[0] + bbox[2]) / 2} embedded bounds={bbox} boundsPadding={32} interactiveLayerIds={['ride-real-casing', 'ride-planned-casing']} onMouseMove={onMove} onClick={onTap} onMouseLeave={clear}>
      <TrackTip tip={tip} />
      {colors && (
        <Source id="ride-planned" type="geojson" data={{ type: 'Feature', properties: {}, geometry: planned } as never}>
          <Layer id="ride-planned-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.card, 'line-width': 6, 'line-opacity': 0.85 }} />
          <Layer id="ride-planned-line" type="line" layout={{ 'line-join': 'round' }} paint={{ 'line-color': colors.foreground, 'line-width': 3, 'line-dasharray': [2, 2], 'line-opacity': 0.8 }} />
        </Source>
      )}
      {colors && ride && (
        <Source id="ride-real" type="geojson" data={{ type: 'Feature', properties: {}, geometry: ride } as never}>
          <Layer id="ride-real-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.card, 'line-width': 7 }} />
          <Layer id="ride-real-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.primary, 'line-width': 4 }} />
        </Source>
      )}
      {photos?.map((p) => (
        <Marker key={p.id} longitude={p.lon} latitude={p.lat} anchor="center">
          <button type="button" aria-label={photoLabel} onClick={() => onPhoto?.(p.id)} className="flex size-touch items-center justify-center">
            <span className="flex size-8 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-md">
              <Camera aria-hidden className="size-4" />
            </span>
          </button>
        </Marker>
      ))}
    </BaseMap>
  );
}
