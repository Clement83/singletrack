import { expect, test } from '@playwright/test';

// #1596 : toucher une sortie sur la carte affiche son parcours figé coloré par pente, la légende et le profil (données simulées).
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
type Win = { __explorerMap?: { isStyleLoaded(): boolean; getCenter(): { lng: number; lat: number }; querySourceFeatures(id: string): unknown[] } };

test('sortie : parcours coloré + légende + profil, retiré à la fermeture ; aucun slug de trace', async ({ page }) => {
  await page.route(/tile\.opentopomap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));
  await page.addInitScript(() => { (window as unknown as { __E2E__: boolean }).__E2E__ = true; });
  await page.route(/\/api\/tracks\?.*starts=1/, (r) => r.fulfill({ json: { tracks: [], total: 0 } }));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as Win).__explorerMap?.isStyleLoaded(), undefined, { timeout: 60_000 });
  const c = await page.evaluate(() => (window as unknown as Win).__explorerMap!.getCenter());
  const coords = [[c.lng, c.lat, 100], [c.lng + 0.005, c.lat + 0.005, 180], [c.lng + 0.01, c.lat + 0.01, 140]];
  const outing = {
    id: 'o1', title: 'Sortie e2e', startsAt: '2099-05-10T06:30:00.000Z', lat: c.lat, lon: c.lng, meetingLabel: null, distanceM: 1400, gainM: 80,
    level: 'intermediate', ebike: 'no', visibility: 'public', organizerName: 'Alice', yesCount: 1, spotsLeft: null, mine: false,
  };
  await page.route(/\/api\/outings\/map\?/, (r) => r.fulfill({ json: { outings: [outing] } }));
  await page.route(/\/api\/outings\/map\/o1$/, (r) => r.fulfill({
    json: {
      geometry: { type: 'LineString', coordinates: coords }, bbox: [c.lng, c.lat, c.lng + 0.01, c.lat + 0.01], end: [c.lng + 0.01, c.lat + 0.01],
      profile: coords.map((p, i) => ({ distKm: i * 0.7, ele: p[2], lon: p[0], lat: p[1] })),
    },
  }));
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as Win).__explorerMap?.isStyleLoaded(), undefined, { timeout: 60_000 });
  const openLine = () => page.evaluate(() => (window as unknown as Win).__explorerMap!.querySourceFeatures('open').length);

  expect(await openLine()).toBe(0);
  await page.getByRole('button', { name: /Sortie e2e/ }).click();
  await expect.poll(openLine).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Pentes' })).toBeVisible();
  await expect(page.getByTestId('outing-panel-footer').getByRole('slider')).toBeVisible();
  expect(await page.content()).not.toContain('e2e-trace-slug');
  // Fermer le panneau retire le tracé.
  await page.getByRole('button', { name: 'Fermer' }).first().click();
  await expect.poll(openLine).toBe(0);
});
