'use client';

import { useSyncExternalStore } from 'react';

// Réglage « Aimant » (#1437) : actif par défaut, mémorisé dans le navigateur (préférence de confort).
const KEY = 'singletrack.editor.snap';
const EVENT = 'singletrack:editor-snap';
const read = () => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};
export function setSnapPref(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* non mémorisé, sans conséquence */
  }
  window.dispatchEvent(new Event(EVENT));
}
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
};
export const useSnapPref = () => useSyncExternalStore(subscribe, read, () => true);
