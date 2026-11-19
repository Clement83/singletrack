'use client';

import { useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { MapRef } from 'react-map-gl/maplibre';
import { Skeleton } from '@/components/ui/skeleton';
import { ElevationProfile } from '@/components/elevation-profile';
import type { TrackGeometry } from '@/lib/geo/types';
import type { LocatedProfilePoint } from '@/lib/elevation';
import { SlopeLegend } from '@/components/map/slope-legend';
import { slopeFeatures } from '@/lib/geo/slope-features';
import { useNearViewport } from '@/lib/use-near-viewport';
import { useMapColors } from './use-map-colors';

// Map loaded on demand (#1371): nothing from react-map-gl / MapLibre in the page's initial JS.
const TrackDetailMap = dynamic(() => import('./track-detail-map'), { ssr: false, loading: () => <Skeleton className="size-full" /> });

type Props = {
  geometry: TrackGeometry;
  bbox: [number, number, number, number];
  start: [number, number];
  end: [number, number];
  /** Sampled profile + position of each point (for the synchronised marker). */
  profile: LocatedProfilePoint[];
};

/**
 * Sheet map (embedded: two fingers to move it) + synchronised elevation profile (#1391):
 * profile cursor → marker on the map; mouse hover on the track → cursor on the profile.
 */
export function TrackDetail({ geometry, bbox, start, end, profile }: Props) {
  const colors = useMapColors();
  const [cursor, setCursor] = useState<number | null>(null);
  // Hovering the track on the map (mouse): places the profile cursor without moving the map.
  const [hover, setHover] = useState<number | null>(null);
  const mapRef = useRef<MapRef>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  const near = useNearViewport(mapBox);
  const data = useMemo(() => slopeFeatures(geometry), [geometry]);
  const marked = cursor !== null ? profile[cursor] : hover !== null ? profile[hover] : null;
  const points = profile;

  if (!colors) return <div className="h-[45dvh] min-h-72 rounded-2xl bg-muted" />;
  return (
    <div className="flex flex-col gap-4">
      <div ref={mapBox} className="relative h-[45dvh] min-h-72 overflow-hidden rounded-2xl border border-border shadow-sm lg:h-[60dvh]">
        {near ? (
          <TrackDetailMap geometry={geometry} bbox={bbox} start={start} end={end} profile={profile} data={data} colors={colors} mapRef={mapRef} marked={marked} setHover={setHover} />
        ) : (
          <Skeleton className="size-full" />
        )}
        {data.features.some((f) => f.properties.cls !== 'none') && <SlopeLegend className="left-2 top-2" />}
      </div>
      {points.length > 1 && (
        <ElevationProfile
          points={points}
          slopes
          cursor={hover}
          onScrub={(p) => setCursor(p ? p.index : null)}
        />
      )}
    </div>
  );
}
