'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Maximize2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { MapRef } from 'react-map-gl/maplibre';
import { ElevationProfile } from '@/components/elevation-profile';
import { useFlyoverLink } from '@/components/map/flyover';
import { SlopeLegend } from '@/components/map/slope-legend';
import { Skeleton } from '@/components/ui/skeleton';
import { useMapColors } from '@/components/tracks/use-map-colors';
import { formatElevation, formatKm } from '@/lib/format';
import { slopeFeatures } from '@/lib/geo/slope-features';
import type { TrackGeometry } from '@/lib/geo/types';
import type { LocatedProfilePoint } from '@/lib/elevation';
import { useNearViewport } from '@/lib/use-near-viewport';

const TrackDetailMap = dynamic(() => import('@/components/tracks/track-detail-map'), { ssr: false, loading: () => <Skeleton className="size-full" /> });

type Props = {
  name: string;
  geometry: TrackGeometry;
  bbox: [number, number, number, number];
  start: [number, number];
  end: [number, number];
  distanceM: number;
  elevationGainM: number | null;
  profile: LocatedProfilePoint[];
};

/**
 * Route of the outing view (#1621): frozen ~200 px preview (the finger scrolls the page), synchronised profile in
 * a card, full screen (native dialog: Escape, trapped focus) to pan and zoom. Frozen-route data only.
 */
export function OutingRoute({ name, geometry, bbox, start, end, distanceM, elevationGainM, profile }: Props) {
  const t = useTranslations('outingView');
  const locale = useLocale();
  const colors = useMapColors();
  const [cursor, setCursor] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const flyover = useFlyoverLink();
  const box = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const previewRef = useRef<MapRef>(null);
  const fullRef = useRef<MapRef>(null);
  const near = useNearViewport(box);
  const data = useMemo(() => slopeFeatures(geometry), [geometry]);
  const marked = cursor !== null ? profile[cursor] ?? null : null;
  const hasSlopes = data.features.some((f) => f.properties.cls !== 'none');
  const stats = `${formatKm(distanceM / 1000, locale)}${elevationGainM != null ? ` · ${formatElevation(elevationGainM, locale)}` : ''}`;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const none = () => undefined;
  return (
    <div className="flex flex-col gap-3">
      <div ref={box} className="relative h-[200px] overflow-hidden rounded-2xl border border-border shadow-sm">
        {colors && near ? (
          <TrackDetailMap geometry={geometry} bbox={bbox} start={start} end={end} profile={profile} data={data} colors={colors} mapRef={previewRef} marked={marked} setHover={none} interactive={false} />
        ) : (
          <Skeleton className="size-full" />
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('expandMap')}
          className="absolute inset-0 flex items-start justify-end p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden className="flex size-11 items-center justify-center rounded-full bg-card/95 text-foreground shadow-md"><Maximize2 className="size-5" /></span>
        </button>
      </div>
      {profile.length > 1 && (
        <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
          <ElevationProfile points={profile} slopes onScrub={(p) => setCursor(p ? p.index : null)} />
        </div>
      )}
      <dialog
        ref={dialog}
        aria-label={name}
        onClose={() => setOpen(false)}
        className="m-0 size-full max-h-none max-w-none bg-background p-0 text-foreground backdrop:bg-scrim"
      >
        {open && colors && (
          <div className="relative size-full">
            <TrackDetailMap geometry={geometry} bbox={bbox} start={start} end={end} profile={profile} data={data} colors={colors} mapRef={fullRef} marked={marked} setHover={(i) => setCursor(i)} embedded={false} flyover={flyover} />
            {hasSlopes && <SlopeLegend className="left-2 top-16" />}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('closeMap')}
              className="absolute left-2 top-2 z-20 flex size-11 items-center justify-center rounded-full bg-card text-foreground shadow-md focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-5" />
            </button>
            <div className="absolute inset-x-0 bottom-0 z-10 bg-card/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <p className="truncate text-heading">{name}</p>
              <p className="text-small tabular-nums text-muted-foreground">{stats}</p>
              {flyover.active && profile.length > 1 && (
                <div className="mt-2 hidden lg:block" {...flyover.seekProps}>
                  <ElevationProfile points={profile} slopes legend={false} compact cursor={flyover.cursor} onScrub={(p) => flyover.trackHover(p ? p.index : null)} />
                </div>
              )}
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
