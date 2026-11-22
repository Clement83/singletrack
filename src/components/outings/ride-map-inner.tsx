'use client';

import { Layer, Marker, Source } from 'react-map-gl/maplibre';
import { Camera, Video } from 'lucide-react';
import { TrackTip, useTrackTip } from '@/components/map/track-tip';
import BaseMap from '@/components/BaseMap';
import { useMapColors } from '@/components/tracks/use-map-colors';
import type { TrackGeometry } from '@/lib/geo/types';
import type { MediaPoint } from '@/lib/outings/media-points';

export type RideMapProps = {
  planned: TrackGeometry;
  ride: TrackGeometry | null;
  bbox: [number, number, number, number];
  /** Located photos (#1413) and videos (#1702): one chip ≥ 44 px each (camera / video icon), a tap opens it. */
  media?: MediaPoint[];
  labels?: { photo: string; video: string };
  onMedia?: (m: MediaPoint) => void;
};

/** Planned (dashed, discreet) under the actual ride (solid line): the gap shows immediately. */
export default function RideMapInner({ planned, ride, bbox, media, labels, onMedia }: RideMapProps) {
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
      {media?.map((p) => (
        <Marker key={p.id} longitude={p.lon} latitude={p.lat} anchor="center">
          <button type="button" aria-label={p.type === 'video' ? labels?.video : labels?.photo} onClick={() => onMedia?.(p)} className="flex size-touch items-center justify-center" data-testid={`ride-map-${p.type}`}>
            <span className="flex size-8 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-md">
              {p.type === 'video' ? <Video aria-hidden className="size-4" /> : <Camera aria-hidden className="size-4" />}
            </span>
          </button>
        </Marker>
      ))}
    </BaseMap>
  );
}
