// Génère le favicon et les icônes PWA depuis le SVG source (#1387) :
//   public/icons/vtt-app-icon-descente-pedales.svg (fourni par Clément, ne pas modifier à la main).
// Sorties : src/app/icon.svg (favicon), public/icons/icon.svg (manifest, taille « any »),
//           icon-192/512.png (any), maskable-512.png (vélo réduit dans la zone de sécurité 80 %),
//           apple-touch-icon.png (180). Rendu par sharp (dépendance de Next, déjà installée).
// Usage (conteneur jetable) : docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/app -w /app node:22-slim node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const SRC = 'public/icons/vtt-app-icon-descente-pedales.svg';
const BIKE = '<g transform="rotate(10 256 300)">';

// Retire le manifeste C2PA (≈ 9 Ko de base64 inutile au navigateur).
const clean = readFileSync(SRC, 'utf8')
  .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
  .replace(/\s+xmlns:c2pa="[^"]*"/, '')
  .replace(/\n{2,}(?=\s*<\/svg>)/, '\n')
  .trim() + '\n';
if (!clean.includes(BIKE)) throw new Error(`groupe du vélo introuvable dans ${SRC}`);

// Maskable : le paysage reste plein cadre (il peut être rogné), le vélo est réduit à 85 %
// autour d'un point du sol pour tenir dans le cercle de sécurité (rayon 40 %).
const maskable = clean
  .replace(BIKE, `<g transform="translate(256 407) scale(0.85) translate(-256 -407)">${BIKE}`)
  .replace(/<\/g>(\s*<\/svg>)/, '</g></g>$1');

const png = (svg, size, out) =>
  sharp(Buffer.from(svg), { density: (72 * size) / 512 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out);

writeFileSync('src/app/icon.svg', clean);
writeFileSync('public/icons/icon.svg', clean);
await Promise.all([
  png(clean, 192, 'public/icons/icon-192.png'),
  png(clean, 512, 'public/icons/icon-512.png'),
  png(maskable, 512, 'public/icons/maskable-512.png'),
  png(clean, 180, 'public/icons/apple-touch-icon.png'),
]);
console.log('icônes générées');
