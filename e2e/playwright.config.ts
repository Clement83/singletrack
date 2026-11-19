import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests (#1523): a real Chromium against the app of the `app-e2e` container (real BRouter).
// Desktop mouse first (decision #1528); mobile touch (`hasTouch`, 375 px) will come with #1537.
const baseURL = process.env.E2E_BASE_URL ?? 'http://app-e2e:3000';

// The session cookie is `Secure` (AUTH_SECURE_COOKIES) and Chromium does not send it to an internal HTTP origin:
// so it is passed as a `Cookie` header on every request (session written by scripts/e2e-session.ts).
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
  // A single test account, a single database: no parallelism between files.
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
        // Internal HTTP origin treated as secure (geolocation, APIs restricted to secure contexts).
        launchOptions: { chromiumSandbox: false, args: [`--unsafely-treat-insecure-origin-as-secure=${baseURL}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
      },
    },
  ],
});
