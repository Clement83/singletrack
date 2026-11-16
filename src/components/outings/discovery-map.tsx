'use client';

import dynamic from 'next/dynamic';
import { useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useNearViewport } from '@/lib/use-near-viewport';
import type { TrackGeometry } from '@/lib/geo/types';

const Inner = dynamic(() => import('./discovery-map-inner'), { ssr: false, loading: () => <Skeleton className="size-full" /> });

/** Carte de la fiche de découverte (#1461) : trace figée + RDV. MapLibre ne se charge qu'à l'approche (#1371). */
export function DiscoveryMap({ geometry, meeting, label }: { geometry: TrackGeometry; meeting: [number, number]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  return (
    <div ref={ref} role="region" aria-label={label} className="h-64 overflow-hidden rounded-2xl border border-border shadow-sm lg:h-96">
      {near ? <Inner geometry={geometry} meeting={meeting} /> : <Skeleton className="size-full" />}
    </div>
  );
}
