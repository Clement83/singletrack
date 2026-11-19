'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

/** Map embedded in a page, loaded on demand (MapLibre is heavy): skeleton meanwhile. */
export const LazyMap = dynamic(() => import('./BaseMap'), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});
