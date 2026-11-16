'use client';

import { useSyncExternalStore } from 'react';

/** `true` si la media query correspond. Côté serveur : `false` (mobile first). */
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

/** Point de rupture desktop de la charte (barre latérale, panneau à la place du sheet). */
export const DESKTOP = '(min-width: 1024px)';
