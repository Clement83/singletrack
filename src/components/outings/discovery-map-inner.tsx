'use client';

import { Layer, Marker, Source } from 'react-map-gl/maplibre';
import { MapPin } from 'lucide-react';
import { TrackTip, useTrackTip } from '@/components/map/track-tip';
import BaseMap from '@/components/BaseMap';
import { useMapColors } from '@/components/tracks/use-map-colors';
import type { TrackGeometry } from '@/lib/geo/types';

const flat = (g: TrackGeometry): [number, number][] => (g.type === 'LineString' ? g.coordinates : g.coordinates.flat()) as [number, number][];

export default function DiscoveryMapInner({ geometry, meeting }: { geometry: TrackGeometry; meeting: [number, number] }) {
  const colors = useMapColors();
  const { tip, onMove, onTap, clear } = useTrackTip((e) => (e.features?.length ? { geometry } : null));
  const pts = [...flat(geometry), meeting];
  const b: [number, number, number, number] = [
    Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])),
  ];
  return (
    <BaseMap lat={meeting[1]} lon={meeting[0]} embedded bounds={b} boundsPadding={40} interactiveLayerIds={['outing-casing']} onMouseMove={onMove} onClick={onTap} onMouseLeave={clear}>
      <TrackTip tip={tip} />
      {colors && (
        <Source id="outing" type="geojson" data={{ type: 'Feature', properties: {}, geometry } as never}>
          <Layer id="outing-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.card, 'line-width': 7, 'line-opacity': 0.9 }} />
          <Layer id="outing-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.primary, 'line-width': 4 }} />
        </Source>
      )}
      <Marker longitude={meeting[0]} latitude={meeting[1]} anchor="bottom" style={{ pointerEvents: 'none' }}>
        <MapPin aria-hidden className="size-8 fill-accent text-primary drop-shadow" />
      </Marker>
    </BaseMap>
  );
}
