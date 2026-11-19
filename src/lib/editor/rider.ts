'use client';

import { useSyncExternalStore } from 'react';
import type { Rider } from '@/lib/routing/score';

// "Muscle / e-bike" routing choice (#1385), remembered in the browser (comfort preference, no account).
const KEY = 'singletrack.editor.rider';
const EVENT = 'singletrack:editor-rider';
const read = (): Rider => {
  try {
    return localStorage.getItem(KEY) === 'ebike' ? 'ebike' : 'muscle';
  } catch {
    return 'muscle';
  }
};
export function setRider(r: Rider) {
  try {
    localStorage.setItem(KEY, r);
  } catch {
    /* not remembered, no consequence */
  }
  window.dispatchEvent(new Event(EVENT));
}
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};
export const useRider = () => useSyncExternalStore(subscribe, read, (): Rider => 'muscle');
