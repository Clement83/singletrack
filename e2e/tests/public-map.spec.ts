import { expect, test, type Page } from '@playwright/test';

// Carte publique (#1591) : un visiteur **sans cookie** explore la carte, ouvre une trace et télécharge son GPX ;
// les actions réservées mènent à la connexion avec retour sur la même vue. Données simulées comme dans explorer-panel.
test.use({ extraHTTPHeaders: {} });

const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
type Win = { __explorerMap?: { isStyleLoaded(): boolean; getCenter(): { lng: number; lat: number }; project(l: number[]): { x: number; y: number } } };

async function load(page: Page, url: string) {
  await page.route(/tile\.opentopomap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));
  await page.addInitScript(() => { (window as unknown as { __E2E__: boolean }).__E2E__ = true; });
  await page.goto(url);
  await page.waitForFunction(() => !!(window as unknown as Win).__explorerMap?.isStyleLoaded(), undefined, { timeout: 60_000 });
}

test('visiteur : carte sans compte, fiche + GPX, « Préparer une sortie » mène à la connexion avec la vue', async ({ page }) => {
  // Sans session : la carte répond (pas de redirection), les autres pages restent privées.
  await load(page, '/');
  await expect(page).toHaveURL(/^[^?]*\/(\?.*)?$/);
  const c = await page.evaluate(() => (window as unknown as Win).__explorerMap!.getCenter());
  const start = [c.lng, c.lat];
  const coords = [[c.lng, c.lat, 100], [c.lng + 0.005, c.lat + 0.005, 180], [c.lng + 0.01, c.lat + 0.01, 140]];
  await page.route(/\/api\/tracks\?.*starts=1/, (r) => r.fulfill({ json: { tracks: [{ slug: 'e2e-pub', name: 'e2e-pub', start, distanceKm: 10, gainM: 200, difficulty: 'blue', loop: true, source: 'osm', status: 'published', bbox: [c.lng, c.lat, c.lng + 0.01, c.lat + 0.01] }], total: 1 } }));
  await page.route(/\/api\/tracks\/e2e-pub$/, (r) => r.fulfill({ json: {
    slug: 'e2e-pub', name: 'e2e-pub', status: 'published', visibility: null, difficulty: 'blue', loop: true, source: 'osm', distanceM: 1400, gainM: 80, lossM: 40, minEle: 100, maxEle: 180, durationMin: 20,
    description: null, author: 'Alice', license: 'ODbL', attribution: '© OpenStreetMap', sourceUrl: null,
    geometry: { type: 'LineString', coordinates: coords }, bbox: [c.lng, c.lat, c.lng + 0.01, c.lat + 0.01], start, end: [c.lng + 0.01, c.lat + 0.01],
    profile: coords.map((p, i) => ({ distKm: i * 0.7, ele: p[2], lon: p[0], lat: p[1] })),
    rights: { edit: false, copy: false, delete: false }, outings: [],
  } }));
  await load(page, '/?q=e2e');

  // Mode visiteur : ni « Mes traces », ni import, ni création ; « Se connecter » à la place du menu.
  await expect(page.getByRole('button', { name: 'Mes traces' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Créer une trace|Importer un GPX/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mon compte' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible();

  const box = (await page.locator('.maplibregl-canvas').boundingBox())!;
  const p = await page.evaluate((ll) => (window as unknown as Win).__explorerMap!.project(ll), start);
  await page.mouse.click(box.x + p.x, box.y + p.y);
  await expect(page).toHaveURL(/t=e2e-pub/);
  await expect(page.getByTestId('track-panel').getByText(/1,4\s*km/)).toBeVisible();
  const footer = page.getByTestId('track-panel-footer');
  await expect(footer.getByRole('link', { name: 'Télécharger le GPX' })).toHaveAttribute('href', '/api/t/e2e-pub/gpx');

  await footer.getByRole('link', { name: /Préparer une sortie/ }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  const next = new URL(page.url()).searchParams.get('next')!;
  expect(next).toMatch(/^\/\?/);
  expect(next).toContain('t=e2e-pub');
  expect(next).toMatch(/z=[\d.]+/);
});

test('visiteur : les lectures de la carte répondent sans session, le reste est privé', async ({ page }) => {
  expect((await page.request.get('/api/tracks?starts=1')).status()).toBe(200);
  expect((await page.request.get('/api/tracks?mine=1')).status()).toBe(401);
  await page.goto('/sorties');
  await expect(page).toHaveURL(/\/login/);
});
