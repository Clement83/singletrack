'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/** Carte intégrée à une page, chargée à la demande (MapLibre est lourd) : squelette en attendant. */
export const LazyMap = dynamic(() => import('./BaseMap'), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});
