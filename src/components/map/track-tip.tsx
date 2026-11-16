'use client';

import { useCallback, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { MapLayerMouseEvent } from 'react-map-gl/maplibre';
import { kmAlongTrack } from '@/lib/geo/along';
import type { Position, TrackGeometry } from '@/lib/geo/types';

export type TrackTipState = { x: number; y: number; kms: number[]; ele?: number | null } | null;

/**
 * État de l'infobulle « km depuis le départ » (#1535). Souris : suit le survol de la trace ; toucher : un tap sur
 * la trace l'affiche, le tap suivant (sur la trace, ou ailleurs) la déplace ou la retire. Jamais d'information
 * au seul survol : le tap donne la même chose.
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
    /** À brancher sur `onMouseMove` (survol, souris seulement : le tactile n'en émet pas). */
    onMove: useCallback((e: MapLayerMouseEvent) => setTip(at(e)), [at]),
    /** À brancher sur `onClick` : tap sur la trace → infobulle ; tap ailleurs → disparaît. */
    onTap: useCallback((e: MapLayerMouseEvent) => setTip(at(e)), [at]),
  };
}

/** Infobulle posée près du curseur / du doigt : « km 12,4 » (deux valeurs si la trace repasse ici), altitude si connue. */
export function TrackTip({ tip }: { tip: TrackTipState }) {
  const t = useTranslations('map');
  const format = useFormatter();
  if (!tip) return null;
  const fmt = (km: number) => t('tipKm', { km: format.number(km, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-20 flex items-center gap-2 rounded-lg bg-popover px-2.5 py-1.5 text-small whitespace-nowrap text-popover-foreground tabular-nums shadow-md"
      style={{ left: tip.x + 14, top: tip.y + 14 }}
    >
      <span className="font-semibold">{tip.kms.map(fmt).join(' · ')}</span>
      {tip.ele != null && <span>{t('tipEle', { ele: format.number(Math.round(tip.ele)) })}</span>}
    </div>
  );
}
