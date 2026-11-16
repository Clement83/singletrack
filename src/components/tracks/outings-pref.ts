'use client';

import { useCallback, useSyncExternalStore } from 'react';

const PREF_KEY = 'singletrack.outings-layer';
const PREF_EVENT = 'singletrack:outings-pref';

/** Couche « Sorties à venir » (#1461) : active par défaut, mémorisée en localStorage (pas dans l'URL). */
export function useOutingsPref(): [boolean, (v: boolean) => void] {
  const on = useSyncExternalStore(
    (cb) => {
      window.addEventListener(PREF_EVENT, cb);
      window.addEventListener('storage', cb);
      return () => {
        window.removeEventListener(PREF_EVENT, cb);
        window.removeEventListener('storage', cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(PREF_KEY) !== 'off';
      } catch {
        return true;
      }
    },
    () => true,
  );
  const set = useCallback((v: boolean) => {
    try {
      localStorage.setItem(PREF_KEY, v ? 'on' : 'off');
    } catch {
      /* stockage indisponible : la préférence ne survit pas au rechargement */
    }
    window.dispatchEvent(new Event(PREF_EVENT));
  }, []);
  return [on, set];
}
