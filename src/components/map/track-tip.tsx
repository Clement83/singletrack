'use client';

import { useCallback, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { MapLayerMouseEvent } from 'react-map-gl/maplibre';
import { kmAlongTrack } from '@/lib/geo/along';
import type { Position, TrackGeometry } from '@/lib/geo/types';

export type TrackTipState = { x: number; y: number; kms: number[]; ele?: number | null } | null;

/**
 * State of the "km from the start" tooltip (#1535). Mouse: follows the hover on the track; touch: a tap on
 * the track shows it, the next tap (on the track, or elsewhere) moves or removes it. Never information
 * on hover alone: the tap gives the same thing.
 */
export function useTrackTip(resolve: (e: MapLayerMouseEvent) => { geometry: TrackGeometry | Position[]; totalKm?: number; ele?: (lon: number, lat: number) => number | null } | null) {
  const [tip, setTip] = useState<TrackTipState>(null);
  const at = useCallback(
    (e: MapLayerMouseEvent): TrackTipState => {
      const src = resolve(e);
      if (!src) return null;
      const r = kmAlongTrack(src.geometry, e.lngLat.lng, e.lngLat.lat, src.totalKm);
      return r ? { x: e.point.x, y: e.point.y, kms: r.kms, ele: src.ele?.(e.lngLat.lng, e.lngLat.lat) ?? null } : null;
    },
    [resolve],
  );
  return {
    tip,
    clear: useCallback(() => setTip(null), []),
    /** To wire on `onMouseMove` (hover, mouse only: touch does not emit it). */
    onMove: useCallback((e: MapLayerMouseEvent) => setTip(at(e)), [at]),
    /** To wire on `onClick`: tap on the track → tooltip; tap elsewhere → disappears. */
    onTap: useCallback((e: MapLayerMouseEvent) => setTip(at(e)), [at]),
  };
}

/** Tooltip placed near the cursor / finger: "km 12.4" (two values if the track passes here again), elevation if known. */
export function TrackTip({ tip }: { tip: TrackTipState }) {
  const t = useTranslations('map');
  const format = useFormatter();
  if (!tip) return null;
  const fmt = (km: number) => t('tipKm', { km: format.number(km, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-20 flex items-center gap-2 rounded-lg floating px-2.5 py-1.5 text-small whitespace-nowrap text-popover-foreground tabular-nums"
      style={{ left: tip.x + 14, top: tip.y + 14 }}
    >
      <span className="font-semibold">{tip.kms.map(fmt).join(' · ')}</span>
      {tip.ele != null && <span>{t('tipEle', { ele: format.number(Math.round(tip.ele)) })}</span>}
    </div>
  );
}
