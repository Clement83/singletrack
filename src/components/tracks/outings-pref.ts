'use client';

import { useCallback, useSyncExternalStore } from 'react';

const PREF_KEY = 'singletrack.outings-layer';
const PREF_EVENT = 'singletrack:outings-pref';

/** "Upcoming outings" layer (#1461): on by default, remembered in localStorage (not in the URL). */
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
      /* storage unavailable: the preference does not survive a reload */
    }
    window.dispatchEvent(new Event(PREF_EVENT));
  }, []);
  return [on, set];
}
