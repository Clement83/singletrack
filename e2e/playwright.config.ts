import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Tests de bout en bout (#1523) : un vrai Chromium contre l'app du conteneur `app` (BRouter réel).
// Desktop souris d'abord (décision #1528) ; le mobile tactile (`hasTouch`, 375 px) viendra avec #1537.
const baseURL = process.env.E2E_BASE_URL ?? 'http://app-e2e:3000';

// Le cookie de session est `Secure` (AUTH_SECURE_COOKIES) et Chromium ne l'envoie pas à une origine HTTP interne :
// on le passe donc en en-tête `Cookie` sur toutes les requêtes (session écrite par scripts/e2e-session.ts).
const cookieHeader = (() => {
  try {
    const st = JSON.parse(fs.readFileSync('.auth/state.json', 'utf8')) as { cookies: { name: string; value: string }[] };
    return st.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
})();

export default defineConfig({
  testDir: './tests',
  // Un seul compte de test, une seule base : pas de parallélisme entre fichiers.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  outputDir: '/results',
  use: {
    baseURL,
    extraHTTPHeaders: cookieHeader ? { Cookie: cookieHeader } : {},
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        // Origine HTTP interne jugée sûre (géolocalisation, API réservées aux contextes sécurisés).
        launchOptions: { chromiumSandbox: false, args: [`--unsafely-treat-insecure-origin-as-secure=${baseURL}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
      },
    },
  ],
});
