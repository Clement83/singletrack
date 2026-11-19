import { expect, test } from '@playwright/test';

// #1596: tapping an outing on the map shows its frozen route coloured by slope, the legend and the profile (mocked data).
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
      description: 'Ligne 1\nLigne 2', track: { name: 'Parcours figé', distanceM: 1400, elevationGainM: 80, attribution: null, license: null }, participants: null,
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
  // #1599: the panel is an OutingView (description with line breaks, meeting point, who's coming), without weather.
  await expect(page.locator('[data-outing-view="panel"]')).toContainText('Ligne 1');
  await expect(page.locator('[data-outing-view="panel"] p.whitespace-pre-line')).toContainText('Ligne 2');
  await expect(page.getByTestId('outing-panel-footer').getByRole('slider')).toBeVisible();
  expect(await page.content()).not.toContain('e2e-trace-slug');
  // Closing the panel removes the line.
  await page.getByRole('button', { name: 'Fermer' }).first().click();
  await expect.poll(openLine).toBe(0);
});

// #1639: "See the page" in the panel footer navigates to the outing page (desktop mouse, mobile touch 375 px).
for (const mode of ['desktop', 'mobile'] as const) {
  test.describe(`#1639 ${mode}`, () => {
    if (mode === 'mobile') test.use({ viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true });
    test('« Voir la fiche » ouvre /sorties/<id>', async ({ page }) => {
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
          description: 'Ligne 1', track: { name: 'Parcours figé', distanceM: 1400, elevationGainM: 80, attribution: null, license: null }, participants: null,
          profile: coords.map((p, i) => ({ distKm: i * 0.7, ele: p[2], lon: p[0], lat: p[1] })),
        },
      }));
      await page.reload();
      await page.waitForFunction(() => !!(window as unknown as Win).__explorerMap?.isStyleLoaded(), undefined, { timeout: 60_000 });
      await page.getByRole('button', { name: /Sortie e2e/ }).click();
      const link = page.getByTestId('outing-panel-footer').locator('a', { hasText: 'Voir la fiche' });
      await expect(link).toBeVisible();
      if (mode === 'mobile') await link.tap(); else await link.click();
      await expect(page).toHaveURL(/\/sorties\/o1$/);
    });
  });
}
