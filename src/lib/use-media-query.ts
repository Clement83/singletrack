'use client';

import { useSyncExternalStore } from 'react';

/** `true` if the media query matches. On the server: `false` (mobile first). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Desktop breakpoint of the charter (side bar, panel instead of the sheet). */
export const DESKTOP = '(min-width: 1024px)';
