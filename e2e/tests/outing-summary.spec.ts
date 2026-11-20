import { expect, test } from '@playwright/test';

// Outing summary player (#1694), desktop: launch, stop on the first media, Escape. Mocked recap, photos and tiles.
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('résumé : le film s’arrête sur la première photo, Échap ferme', async ({ page }) => {
  await page.route(/tile\.opentopomap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));
  await page.route(/elevation-tiles-prod/, (r) => r.abort());
  const x = 6.1, y = 43.4;
  const coords = [[x, y, 100], [x + 0.004, y + 0.002, 120], [x + 0.008, y, 110], [x + 0.012, y + 0.004, 150]];
  const placement = (d: number) => ({ method: 'time', distanceM: d, at: null, pos: null });
  const m = (id: string, type: 'photo' | 'video', d: number | null) => ({
    id, type, author: 'Alice', organizer: false, width: 1, height: 1, takenAt: null, durationMs: type === 'video' ? 4000 : null,
    placement: d == null ? { method: 'none', distanceM: null, at: null, pos: null } : placement(d),
  });
  await page.route('**/api/styleguide/recap', (r) => r.fulfill({
    json: {
      track: {
        id: 'r1', geometry: { type: 'LineString', coordinates: coords }, bbox: [x, y, x + 0.012, y + 0.004], distanceM: 1700, gainM: 50,
        times: coords.map((_, i) => 1_700_000_000_000 + i * 600_000), profile: coords.map((p, i) => ({ km: i * 0.57, ele: p[2] })),
      },
      media: [m('p1', 'photo', 150), m('p2', 'photo', 900), m('v1', 'video', 1200), m('p3', 'photo', null)],
    },
  }));
  await page.route('**/api/styleguide/photos/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));
  await page.route('**/api/styleguide/videos/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));

  await page.goto('/styleguide');
  await page.getByTestId('summary-open').click();
  await expect(page.getByTestId('summary-stage')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('summary-mark')).toHaveCount(3);
  // The point stops on the first media (a photo of the first stop) and shows it over the map.
  await expect(page.getByTestId('summary-media')).toHaveAttribute('data-media-id', 'p1', { timeout: 60_000 });
  // Pause then resume from the keyboard.
  await page.keyboard.press(' ');
  await expect(page.getByTestId('summary-playpause')).toHaveAccessibleName(/Lecture|Play/);
  await page.keyboard.press('ArrowRight'); // next media
  await expect(page.getByTestId('summary-media')).toHaveAttribute('data-media-id', 'p2');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('summary-stage')).toHaveCount(0);
});
