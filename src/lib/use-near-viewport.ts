'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * `true` as soon as the element nears the screen (margin `margin`), and stays so (#1371):
 * used to load MapLibre (~1 MB of JS) only when the map is about to be seen, not at hydration.
 */
export function useNearViewport(ref: RefObject<Element | null>, margin = '300px'): boolean {
  const [near, setNear] = useState(false);
  // Element actually observed: it may only be mounted after the first render (#1425), so
  // the effect runs on every render and only (re)observes if the element changed.
  const [observed, setObserved] = useState<Element | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately without dependencies (see above)
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
