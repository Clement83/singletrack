'use client';

import { useEffect, useRef } from 'react';

/** Device with mouse/keyboard (not a phone or a touch tablet). */
export const FINE_POINTER = '(hover: hover) and (pointer: fine)';

/**
 * Focus on mount, **only with mouse and keyboard** (#1390, ui-ux skill): on mobile, `autoFocus` opens the
 * keyboard and hides the screen. Set it as `ref` on the main field.
 */
export function useDesktopAutoFocus<T extends HTMLElement = HTMLInputElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (window.matchMedia(FINE_POINTER).matches) ref.current?.focus();
  }, []);
  return ref;
}
