'use client';

import { useEffect, useState } from 'react';

const SLOPE_KEYS = ['up-1', 'up-2', 'up-3', 'up-4', 'up-5', 'down-1', 'down-2', 'down-3', 'down-4', 'down-5'] as const;
type SlopeKey = `slope-${(typeof SLOPE_KEYS)[number]}`;
export type MapColors = Record<'green' | 'blue' | 'red' | 'black' | 'primary' | 'card' | 'foreground' | 'muted' | 'fire1' | 'fire2' | 'fire3' | 'fire4' | 'fire5' | 'preview' | SlopeKey, string>;
const VARS: Record<keyof MapColors, string> = {
  ...(Object.fromEntries(SLOPE_KEYS.map((k) => [`slope-${k}`, `--slope-${k}`])) as Record<SlopeKey, string>),
  muted: '--muted-foreground',
  preview: '--map-preview',
  green: '--diff-green',
  blue: '--diff-blue',
  red: '--diff-red',
  black: '--diff-black',
  primary: '--primary',
  card: '--card',
  foreground: '--foreground',
  fire1: '--fire-1',
  fire2: '--fire-2',
  fire3: '--fire-3',
  fire4: '--fire-4',
  fire5: '--fire-5',
};

function read(): MapColors {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(Object.entries(VARS).map(([k, v]) => [k, cs.getPropertyValue(v).trim() || 'transparent'])) as MapColors;
}

/** `null` avant le premier rendu client. Couleurs des tokens (MapLibre n'accepte pas `var(--x)`), relues quand le thème change. */
export function useMapColors(): MapColors | null {
  const [colors, setColors] = useState<MapColors | null>(null);
  useEffect(() => {
    const update = () => setColors(read());
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-charte', 'style'] });
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', update);
    return () => {
      mo.disconnect();
      mql.removeEventListener('change', update);
    };
  }, []);
  return colors;
}
