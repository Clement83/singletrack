'use client';

import { Layer, Source } from 'react-map-gl/maplibre';
import { TrackTip, useTrackTip } from '@/components/map/track-tip';
import BaseMap from '@/components/BaseMap';
import { useMapColors } from '@/components/tracks/use-map-colors';
import type { TrackGeometry } from '@/lib/geo/types';

export type HistoryRoute = { id: string; geometry: TrackGeometry; bbox: [number, number, number, number] };

export default function HistoryMapInner({ routes }: { routes: HistoryRoute[] }) {
  const colors = useMapColors();
  const { tip, onMove, onTap, clear } = useTrackTip((e) => {
    const r = routes.find((x) => x.id === e.features?.[0]?.properties?.id);
    return r ? { geometry: r.geometry } : null;
  });
  const b = routes.reduce<[number, number, number, number]>(
    (a, r) => [Math.min(a[0], r.bbox[0]), Math.min(a[1], r.bbox[1]), Math.max(a[2], r.bbox[2]), Math.max(a[3], r.bbox[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  const data = { type: 'FeatureCollection' as const, features: routes.map((r) => ({ type: 'Feature' as const, properties: { id: r.id }, geometry: r.geometry })) };
  return (
    <BaseMap lat={(b[1] + b[3]) / 2} lon={(b[0] + b[2]) / 2} embedded bounds={b} boundsPadding={32} interactiveLayerIds={['history-casing']} onMouseMove={onMove} onClick={onTap} onMouseLeave={clear}>
      <TrackTip tip={tip} />
      {colors && (
        <Source id="history" type="geojson" data={data as never}>
          <Layer id="history-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.card, 'line-width': 6, 'line-opacity': 0.9 }} />
          <Layer id="history-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.primary, 'line-width': 3, 'line-opacity': 0.7 }} />
        </Source>
      )}
    </BaseMap>
  );
}
