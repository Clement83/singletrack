import createNextIntlPlugin from 'next-intl/plugin';
import { readFileSync } from 'node:fs';

// Version publiée (#1485) : source unique = package.json, injectée au build (config.version, /api/health, menu).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// i18n (#1400) : langue résolue par requête dans src/i18n/request.ts (sans préfixe d'URL).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: { APP_VERSION: version },
  // Dossier de build distinct pour lancer plusieurs `next dev` (test d'intégration de la fédération, scripts/federation-two-instances.ts).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Fedify : une seule copie des paquets (sinon `instanceof CryptographicKey` échoue, spike #1471).
  serverExternalPackages: ['better-sqlite3', '@fedify/fedify', '@fedify/vocab', '@fedify/vocab-runtime', '@fedify/webfinger', '@fedify/sqlite', '@fedify/next'],
  // Mode dev servi via un reverse proxy ou le LAN, origines dans ALLOWED_DEV_ORIGINS (#1464) : sinon `next dev` bloque HMR et assets venant de ces origines.
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
};
export default withNextIntl(nextConfig);
