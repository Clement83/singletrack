'use client';

import { useEffect, useRef } from 'react';

/** Appareil avec souris/clavier (pas un téléphone ni une tablette tactile). */
export const FINE_POINTER = '(hover: hover) and (pointer: fine)';

/**
 * Focus au montage, **seulement avec souris et clavier** (#1390, skill ui-ux) : sur mobile, `autoFocus` ouvre le
 * clavier et masque l'écran. À poser en `ref` sur le champ principal.
 */
export function useDesktopAutoFocus<T extends HTMLElement = HTMLInputElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (window.matchMedia(FINE_POINTER).matches) ref.current?.focus();
  }, []);
  return ref;
}
