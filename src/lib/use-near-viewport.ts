'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * `true` dès que l'élément approche de l'écran (marge `margin`), et le reste ensuite (#1371) :
 * sert à ne charger MapLibre (~1 Mo de JS) que lorsque la carte va être vue, pas à l'hydratation.
 */
export function useNearViewport(ref: RefObject<Element | null>, margin = '300px'): boolean {
  const [near, setNear] = useState(false);
  // Élément réellement observé : l'élément peut n'être monté qu'après le premier rendu (#1425), donc
  // l'effet tourne à chaque rendu et ne (ré)observe que si l'élément a changé.
  const [observed, setObserved] = useState<Element | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- volontairement sans dépendances (voir ci-dessus)
  useEffect(() => {
    if (ref.current !== observed) setObserved(ref.current);
  });
  useEffect(() => {
    if (near || !observed) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: margin });
    io.observe(observed);
    return () => io.disconnect();
  }, [observed, margin, near]);
  return near;
}
