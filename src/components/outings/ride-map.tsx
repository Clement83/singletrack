'use client';

import dynamic from 'next/dynamic';
import { useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useNearViewport } from '@/lib/use-near-viewport';
import type { RideMapProps } from './ride-map-inner';

const Inner = dynamic(() => import('./ride-map-inner'), { ssr: false, loading: () => <Skeleton className="size-full" /> });

/** Planned / actual map. MapLibre only loads when the map gets close (#1371). */
export function RideMap({ label, ...props }: RideMapProps & { label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  return (
    <div ref={ref} role="region" aria-label={label} className="h-64 overflow-hidden rounded-2xl border border-border shadow-sm lg:h-96">
      {near ? <Inner {...props} /> : <Skeleton className="size-full" />}
    </div>
  );
}
