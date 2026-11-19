import { expect, test } from '@playwright/test';

// 3D relief (#1668, epic #1666): the track map opens flat; the "3D" button turns the relief on
// and tilts the view, a second click goes back to flat. Mocked tiles: the test depends neither on AWS nor on the basemap.
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

type Win = { __explorerMap?: { isStyleLoaded(): boolean; getPitch(): number; getTerrain(): { source: string } | null } };

test('3D : à plat à l’ouverture, le bouton active le relief incliné puis revient à plat', async ({ page }) => {
  await page.route(/tile\.opentopomap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));
  await page.route(/elevation-tiles-prod/, (r) => r.abort());
  await page.addInitScript(() => { (window as unknown as { __E2E__: boolean }).__E2E__ = true; });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as Win).__explorerMap?.isStyleLoaded(), undefined, { timeout: 60_000 });

  const state = () => page.evaluate(() => {
    const m = (window as unknown as Win).__explorerMap!;
    return { pitch: Math.round(m.getPitch()), terrain: m.getTerrain()?.source ?? null };
  });
  const button = page.getByTestId('terrain-toggle');

  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await state()).toEqual({ pitch: 0, terrain: null });

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(state).toEqual({ pitch: 60, terrain: 'dem' });

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(state).toEqual({ pitch: 0, terrain: null });
});
