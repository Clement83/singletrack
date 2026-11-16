import type { MetadataRoute } from 'next';
import tokens from '../../design/tokens.json';

// Couleurs lues dans la source unique des tokens (jamais en dur).
const light = (name: string) => tokens.color.find((c) => c.name === name)!.value.light;

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Singletrack',
    short_name: 'Singletrack',
    description: 'Sorties VTT dans le Var',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'fr',
    background_color: light('background'),
    theme_color: light('primary'),
    // Icônes générées depuis public/icons/vtt-app-icon-descente-pedales.svg par scripts/make-icons.mjs (#1387).
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
