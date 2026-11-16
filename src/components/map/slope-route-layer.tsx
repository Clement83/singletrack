'use client';

import { Layer, Source } from 'react-map-gl/maplibre';
import type { MapColors } from '@/components/tracks/use-map-colors';
import { slopeMatchExpression, type SlopeCollection } from '@/lib/geo/slope-features';
import { RouteArrows } from './route-arrows';

/** Couleurs MapLibre (valeurs, pas `var(--x)`) de chaque classe de pente, lues sur les tokens. */
export function slopeColorsOf(colors: MapColors): Record<string, string> {
  return Object.fromEntries(Object.entries(colors).filter(([k]) => k.startsWith('slope-')));
}

/**
 * Trace colorée par pente dans son sens de parcours (#1381) : liseré clair dessous, tronçons colorés
 * (montée et descente = deux dégradés), flèches de direction. Réservée au détail d'une trace.
 * À placer dans une carte ; `data` vient de `slopeFeatures` / `slopeFeaturesForRuns` (mémoïsé par l'appelant).
 */
export function SlopeRouteLayer({ id = 'slope', data, colors, arrows = true }: { id?: string; data: SlopeCollection; colors: MapColors; arrows?: boolean }) {
  const color = slopeMatchExpression(slopeColorsOf(colors), colors.muted, colors.primary) as never;
  return (
    <Source id={id} type="geojson" data={data}>
      <Layer id={`${id}-casing`} type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.card, 'line-width': 9 }} />
      <Layer id={`${id}-line`} type="line" layout={{ 'line-cap': 'butt', 'line-join': 'round' }} paint={{ 'line-color': color, 'line-width': 5.5 }} />
      {arrows && <RouteArrows id={`${id}-arrows`} source={id} fill={colors.card} stroke={colors.foreground} />}
    </Source>
  );
}
