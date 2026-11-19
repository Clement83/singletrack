// Generates the favicon and the PWA icons from the source SVG (#1387):
//   public/icons/vtt-app-icon-descente-pedales.svg (provided by the maintainer, do not edit by hand).
// Sorties : src/app/icon.svg (favicon), public/icons/icon.svg (manifest, taille « any »),
//           icon-192/512.png (any), maskable-512.png (bike shrunk into the 80 % safe zone),
//           apple-touch-icon.png (180). Rendered by sharp (a Next dependency, already installed).
// Usage (conteneur jetable) : docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/app -w /app node:22-slim node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const SRC = 'public/icons/vtt-app-icon-descente-pedales.svg';
const BIKE = '<g transform="rotate(10 256 300)">';

// Strips the C2PA manifest (≈ 9 KB of base64 useless to the browser).
const clean = readFileSync(SRC, 'utf8')
  .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
  .replace(/\s+xmlns:c2pa="[^"]*"/, '')
  .replace(/\n{2,}(?=\s*<\/svg>)/, '\n')
  .trim() + '\n';
if (!clean.includes(BIKE)) throw new Error(`bike group not found in ${SRC}`);

// Maskable: the landscape stays full frame (it may be cropped), the bike is shrunk to 85 %
// around a ground point to fit in the safe circle (40 % radius).
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
console.log('icons generated');
