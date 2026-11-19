import type { MetadataRoute } from 'next';
import tokens from '../../design/tokens.json';

// theme_color = page background, like the layout's `viewport.themeColor` (#1649). Colours read from the single token source (never hard-coded).
const light = (name: string) => tokens.color.find((c) => c.name === name)!.value.light;

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Singletrack',
    short_name: 'Singletrack',
    description: 'Sorties VTT',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'fr',
    background_color: light('background'),
    theme_color: light('background'),
    // Icons generated from public/icons/vtt-app-icon-descente-pedales.svg by scripts/make-icons.mjs (#1387).
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
