import { expect, test, type Page } from '@playwright/test';

// Outing summary player (#1694), desktop: launch, stop on the first media, Escape. Mocked recap, photos and tiles.
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Mocks tiles, recap and media files; returns the ids the player sent a DELETE for. */
async function mockSummary(page: Page) {
  const deleted: string[] = [];
  await page.route(/tile\.opentopomap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));
  await page.route(/elevation-tiles-prod/, (r) => r.abort());
  const x = 6.1, y = 43.4;
  const coords = [[x, y, 100], [x + 0.004, y + 0.002, 120], [x + 0.008, y, 110], [x + 0.012, y + 0.004, 150]];
  const placement = (d: number) => ({ method: 'time', distanceM: d, at: null, pos: null });
  const m = (id: string, type: 'photo' | 'video', d: number | null, canDelete = false) => ({
    id, type, author: 'Alice', organizer: false, width: 1, height: 1, takenAt: null, durationMs: type === 'video' ? 4000 : null, canDelete,
    placement: d == null ? { method: 'none', distanceM: null, at: null, pos: null } : placement(d),
  });
  await page.route('**/api/styleguide/recap', (r) => r.fulfill({
    json: {
      track: {
        id: 'r1', geometry: { type: 'LineString', coordinates: coords }, bbox: [x, y, x + 0.012, y + 0.004], distanceM: 1700, gainM: 50,
        times: coords.map((_, i) => 1_700_000_000_000 + i * 600_000), profile: coords.map((p, i) => ({ km: i * 0.57, ele: p[2] })),
      },
      media: [m('p1', 'photo', 150, true), m('p2', 'photo', 900), m('v1', 'video', 1200), m('p3', 'photo', null)],
    },
  }));
  const media = (r: Parameters<Parameters<Page['route']>[1]>[0]) => {
    if (r.request().method() === 'DELETE') {
      deleted.push(r.request().url().split('/').pop()!);
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG });
  };
  await page.route('**/api/styleguide/photos/**', media);
  await page.route('**/api/styleguide/videos/**', media);
  return deleted;
}

async function openSummary(page: Page) {
  await page.goto('/styleguide');
  await page.getByTestId('summary-open').click();
  await expect(page.getByTestId('summary-stage')).toBeVisible({ timeout: 30_000 });
}

test('résumé : le film s’arrête sur la première photo, Échap ferme', async ({ page }) => {
  await mockSummary(page);
  await openSummary(page);
  await expect(page.getByTestId('summary-mark')).toHaveCount(3);
  // Stop icons (#1704): p1 and p2 are photos, v1 a video.
  await expect(page.locator('[data-testid="summary-stop"][data-kind="video"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="summary-stop"][data-kind="photo"]')).toHaveCount(2);
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

test('résumé : supprimer le média affiché (#1701), seulement s’il est supprimable', async ({ page }) => {
  const deleted = await mockSummary(page);
  await openSummary(page);
  await expect(page.getByTestId('summary-media')).toHaveAttribute('data-media-id', 'p1', { timeout: 60_000 });
  await page.getByTestId('summary-delete').click();
  // Confirmation inside the player; the film is paused meanwhile.
  await expect(page.getByTestId('summary-delete-confirm')).toBeVisible();
  await expect(page.getByTestId('summary-playpause')).toHaveAccessibleName(/Lecture|Play/);
  await page.getByTestId('summary-delete-ok').click();
  await expect(page.getByTestId('summary-delete-confirm')).toHaveCount(0);
  expect(deleted).toEqual(['p1']);
  // Out of the film: its mark is gone and the player moves on.
  await expect(page.getByTestId('summary-mark')).toHaveCount(2);
  await expect(page.locator('[data-testid="summary-media"][data-media-id="p1"]')).toHaveCount(0);
  // The film resumes (flying towards p2, far ahead); next media = p2, which this viewer cannot delete: no button.
  await expect(page.getByTestId('summary-playpause')).toHaveAccessibleName(/Pause/);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('summary-media')).toHaveAttribute('data-media-id', 'p2');
  await expect(page.getByTestId('summary-delete')).toHaveCount(0);
});

test('résumé : le point continue d’avancer pendant une vidéo (#1705)', async ({ page }) => {
  await mockSummary(page);
  await openSummary(page);
  await expect(page.getByTestId('summary-media')).toHaveAttribute('data-media-id', 'p1', { timeout: 60_000 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('summary-media')).toHaveAttribute('data-media-id', 'v1');
  const km = page.getByTestId('summary-stats').locator('span').first();
  const before = await km.textContent();
  // The clip lasts 4 s (+3 s safety net): the km counter moves meanwhile, the clip is still on screen.
  await expect.poll(() => km.textContent(), { timeout: 6_000 }).not.toBe(before);
  await expect(page.getByTestId('summary-media')).toHaveAttribute('data-media-id', 'v1');
});
