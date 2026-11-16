'use client';

import dynamic from 'next/dynamic';
import { useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useNearViewport } from '@/lib/use-near-viewport';
import type { HistoryRoute } from './history-map-inner';

const Inner = dynamic(() => import('./history-map-inner'), { ssr: false, loading: () => <Skeleton className="size-full" /> });

/** Carte de toutes les traces des sorties terminées. MapLibre ne se charge qu'à l'approche de la carte (#1371). */
export function HistoryMap({ routes, label }: { routes: HistoryRoute[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  return (
    <div ref={ref} role="region" aria-label={label} className="h-64 overflow-hidden rounded-2xl border border-border shadow-sm lg:h-96">
      {near ? <Inner routes={routes} /> : <Skeleton className="size-full" />}
    </div>
  );
}
