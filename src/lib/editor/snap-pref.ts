'use client';

import { useSyncExternalStore } from 'react';

// "Magnet" setting (#1437): on by default, remembered in the browser (comfort preference).
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
    /* not remembered, no consequence */
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
