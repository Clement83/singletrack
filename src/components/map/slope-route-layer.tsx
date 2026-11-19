'use client';

import { Layer, Source } from 'react-map-gl/maplibre';
import type { MapColors } from '@/components/tracks/use-map-colors';
import { slopeMatchExpression, type SlopeCollection } from '@/lib/geo/slope-features';
import { RouteArrows } from './route-arrows';

/** MapLibre colours (values, not `var(--x)`) of each slope class, read from the tokens. */
export function slopeColorsOf(colors: MapColors): Record<string, string> {
  return Object.fromEntries(Object.entries(colors).filter(([k]) => k.startsWith('slope-')));
}

/**
 * Track coloured by slope in its direction of travel (#1381): light casing underneath, coloured segments
 * (climb and descent = two gradients), direction arrows. Reserved for the detail of a track.
 * To place inside a map; `data` comes from `slopeFeatures` / `slopeFeaturesForRuns` (memoised by the caller).
 */
export function SlopeRouteLayer({ id = 'slope', data, colors, arrows = true, beforeId }: { id?: string; data: SlopeCollection; colors: MapColors; arrows?: boolean; beforeId?: string }) {
  const color = slopeMatchExpression(slopeColorsOf(colors), colors.muted, colors.primary) as never;
  return (
    <Source id={id} type="geojson" data={data}>
      <Layer id={`${id}-casing`} beforeId={beforeId} type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.card, 'line-width': 9 }} />
      <Layer id={`${id}-line`} beforeId={beforeId} type="line" layout={{ 'line-cap': 'butt', 'line-join': 'round' }} paint={{ 'line-color': color, 'line-width': 5.5 }} />
      {arrows && <RouteArrows id={`${id}-arrows`} source={id} fill={colors.card} stroke={colors.foreground} beforeId={beforeId} />}
    </Source>
  );
}
