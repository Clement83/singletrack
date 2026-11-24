'use client';

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useControl, useMap, type ControlPosition } from 'react-map-gl/maplibre';
import type { IControl, Map as MaplibreMap } from 'maplibre-gl';
import { cn } from '@/lib/utils';
import { TERRAIN, terrainPitch } from '@/lib/map/terrain';

/** MapLibre control container in which React renders its button (portal). */
class PortalControl implements IControl {
  readonly container: HTMLDivElement;
  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
  }
  onAdd() {
    return this.container;
  }
  onRemove() {
    this.container.remove();
  }
}

function whenStyleReady(map: MaplibreMap, fn: () => void) {
  // `isStyleLoaded()` goes false again while tiles load (and may stay false when the elevation
  // tiles fail), and 'load' fires only once: gate on the style/source existing instead (#1763).
  if (map.getStyle() && map.getSource(TERRAIN.source)) fn();
  else map.once('styledata', () => whenStyleReady(map, fn));
}

function apply(map: MaplibreMap, on: boolean) {
  whenStyleReady(map, () => {
    map.setTerrain(on ? TERRAIN : null);
    map.easeTo({ pitch: terrainPitch(on), duration: 600 });
  });
}

type Props = { position?: ControlPosition };

/**
 * "3D" button (#1667) in the map's control group: relief (`dem` source of the `BaseMap terrain`
 * style) + pitch. Always flat on opening: 3D only turns on with a click.
 */
export function TerrainToggle({ position = 'top-right' }: Props) {
  const t = useTranslations('map');
  const ctrl = useControl(() => new PortalControl(), { position });
  const { current: mapRef } = useMap();
  const [on, setOn] = useState(false);

  const toggle = useCallback(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const next = !on;
    setOn(next);
    apply(map, next);
  }, [mapRef, on]);

  if (!mapRef) return null;
  const label = on ? t('terrainOff') : t('terrainOn');
  return createPortal(
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={toggle}
      data-testid="terrain-toggle"
      className={cn('text-sm font-semibold text-foreground active:opacity-70', on && 'text-primary')}
    >
      3D
    </button>,
    ctrl.container,
  );
}
