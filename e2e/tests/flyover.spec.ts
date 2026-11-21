import { expect, test } from '@playwright/test';

// 3D flyover (#1690, desktop): the bike follows the open track, the camera moves, Escape stops. Mocked data and tiles.
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

type Win = { __explorerMap?: { isStyleLoaded(): boolean; getCenter(): { lng: number; lat: number }; getPitch(): number } };

const SLUG = '0e2e0f1a-aaaa-4bbb-8ccc-000000000001';

test('survol : le vélo parcourt la trace, la caméra bouge, Échap arrête', async ({ page }) => {
  test.setTimeout(240_000); // #1698: software WebGL on a loaded host renders < 1 frame/s
  await page.route(/tile\.opentopomap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));
  await page.route(/elevation-tiles-prod/, (r) => r.abort());
  await page.addInitScript(() => { (window as unknown as { __E2E__: boolean }).__E2E__ = true; });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as Win).__explorerMap?.isStyleLoaded(), undefined, { timeout: 60_000 });
  const c = await page.evaluate(() => (window as unknown as Win).__explorerMap!.getCenter());

  const x = c.lng, y = c.lat;
  const coords = [[x, y, 100], [x + 0.01, y + 0.005, 180], [x + 0.02, y, 140], [x + 0.03, y + 0.01, 200]];
  const sheet = {
    slug: SLUG, name: 'fly', status: 'published', difficulty: 'blue', loop: false, source: 'osm', distanceM: 4000, gainM: 80, lossM: 40, minEle: 100, maxEle: 200, durationMin: 20,
    description: null, author: 'Alice', license: 'ODbL', attribution: '© OpenStreetMap', sourceUrl: null,
    geometry: { type: 'LineString', coordinates: coords }, bbox: [x, y, x + 0.03, y + 0.01], start: [x, y], end: [x + 0.03, y + 0.01],
    profile: coords.map((p, i) => ({ distKm: i * 1.3, ele: p[2], lon: p[0], lat: p[1] })),
    rights: { edit: false, copy: true, delete: false }, outings: [],
  };
  await page.route(new RegExp(`/api/tracks/${SLUG}$`), (r) => r.fulfill({ json: sheet }));
  await page.route(/\/api\/tracks\?.*starts=1/, (r) => r.fulfill({ json: { tracks: [{ slug: SLUG, name: 'fly', start: [x, y], distanceKm: 4, gainM: 80, difficulty: 'blue', loop: false, source: 'user', status: 'published', bbox: [x, y, x + 0.03, y + 0.01] }], total: 1 } }));
  await page.goto(`/?t=${SLUG}`);
  await page.waitForFunction(() => !!(window as unknown as Win).__explorerMap?.isStyleLoaded(), undefined, { timeout: 60_000 });

  await page.getByTestId('flyover-start').click();
  await expect(page.getByTestId('flyover-bar')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('flyover-speed').click(); // ×2
  await expect(page.getByTestId('flyover-speed')).toHaveText('×2');
  const view = () => page.evaluate(() => {
    const m = (window as unknown as Win).__explorerMap!;
    return { lng: m.getCenter().lng, pitch: Math.round(m.getPitch()) };
  });
  await expect.poll(async () => (await view()).pitch, { timeout: 60_000 }).toBeGreaterThanOrEqual(60);
  const a = await view(); // still in the first seconds of the flight
  await expect.poll(async () => (await view()).lng, { timeout: 60_000 }).not.toBe(a.lng);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('flyover-bar')).toHaveCount(0);
  const b = await view();
  await page.waitForTimeout(500);
  expect((await view()).lng).toBe(b.lng); // the camera no longer moves
});
