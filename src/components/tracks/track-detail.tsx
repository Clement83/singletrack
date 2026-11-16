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

// Carte chargée à la demande (#1371) : rien de react-map-gl / MapLibre dans le JS initial de la page.
const TrackDetailMap = dynamic(() => import('./track-detail-map'), { ssr: false, loading: () => <Skeleton className="size-full" /> });

type Props = {
  geometry: TrackGeometry;
  bbox: [number, number, number, number];
  start: [number, number];
  end: [number, number];
  /** Profil échantillonné + position de chaque point (pour le marqueur synchronisé). */
  profile: LocatedProfilePoint[];
};

/**
 * Carte de la fiche (intégrée : deux doigts pour la déplacer) + profil altimétrique synchronisé (#1391) :
 * curseur du profil → marqueur sur la carte ; survol de la trace à la souris → curseur sur le profil.
 */
export function TrackDetail({ geometry, bbox, start, end, profile }: Props) {
  const colors = useMapColors();
  const [cursor, setCursor] = useState<number | null>(null);
  // Survol de la trace sur la carte (souris) : positionne le curseur du profil sans déplacer la carte.
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
