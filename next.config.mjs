import createNextIntlPlugin from 'next-intl/plugin';
import { readFileSync } from 'node:fs';

// Published version (#1485): single source = package.json, injected at build time (config.version, /api/health, menu).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// i18n (#1400): language resolved per request in src/i18n/request.ts (no URL prefix).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: { APP_VERSION: version },
  // No Next.js badge or menu in development (#1640): the error overlay stays on.
  devIndicators: false,
  // Image builds (#1673): types are already checked by CI (`tsc --noEmit`); skipping the second check saves build time.
  typescript: { ignoreBuildErrors: process.env.SKIP_TYPECHECK === '1' },
  // Separate build folder to run several `next dev` (federation integration test, scripts/federation-two-instances.ts).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Fedify: a single copy of the packages (otherwise `instanceof CryptographicKey` fails, spike #1471).
  serverExternalPackages: ['better-sqlite3', '@fedify/fedify', '@fedify/vocab', '@fedify/vocab-runtime', '@fedify/webfinger', '@fedify/sqlite', '@fedify/next'],
  // Dev server reached through a reverse proxy or the LAN, origins in ALLOWED_DEV_ORIGINS (#1464): otherwise `next dev` blocks HMR and assets from those origins.
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
};
export default withNextIntl(nextConfig);
