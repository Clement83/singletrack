import net from 'node:net';
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
    id, type, author: 'Alice', organizer: false, width: 1, height: 1, takenAt: null, durationMs: type === 'video' ? 20_000 : null, canDelete,
    placement: d == null ? { method: 'none', distanceM: null, at: null, pos: null } : placement(d),
  });
  await page.route('**/api/styleguide/recap', (r) => r.fulfill({
    json: {
      track: {
        id: 'r1', geometry: { type: 'LineString', coordinates: coords }, bbox: [x, y, x + 0.012, y + 0.004], distanceM: 1700, gainM: 50,
        times: coords.map((_, i) => 1_700_000_000_000 + i * 600_000), profile: coords.map((p, i) => ({ km: i * 0.57, ele: p[2] })),
      },
      media: [m('p1', 'photo', 150, true), m('p2', 'photo', 900), m('v1', 'video', 1200), m('p3', 'photo', null)],
      music: [{ id: 0, title: 'Piste' }],
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
  await page.route('**/api/styleguide/music/**', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: sineWav() }));
  return deleted;
}

async function openSummary(page: Page, origin = '') {
  await page.goto(`${origin}/styleguide`);
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
  // Paused, the skips are deterministic even on a loaded machine; then play from the clip.
  await page.keyboard.press(' ');
  await expect(page.getByTestId('summary-playpause')).toHaveAccessibleName(/Lecture|Play/);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('summary-media')).toHaveAttribute('data-media-id', 'p2');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('summary-media')).toHaveAttribute('data-media-id', 'v1');
  const km = page.getByTestId('summary-stats').locator('span').first();
  const before = await km.textContent();
  await page.keyboard.press(' ');
  // The clip lasts 20 s (+3 s safety net): the km counter moves meanwhile, the clip is still on screen.
  await expect.poll(() => km.textContent(), { timeout: 15_000 }).not.toBe(before);
  await expect(page.getByTestId('summary-media')).toHaveAttribute('data-media-id', 'v1');
});

/** One second of a 440 Hz tone, 16-bit mono WAV: decodable background music for the export. */
function sineWav(): Buffer {
  const rate = 8000;
  const n = rate;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return b;
}

test('résumé : export MP4 (#1707), rendu court, fichier téléchargé', async ({ page }) => {
  test.setTimeout(240_000);
  // WebCodecs needs a secure context: the page goes through a localhost relay to the e2e app.
  const target = new URL(test.info().project.use.baseURL!);
  const relay = net.createServer((c) => {
    const u = net.connect(Number(target.port || 80), target.hostname);
    c.pipe(u); u.pipe(c);
    u.on('error', () => c.destroy()); c.on('error', () => u.destroy());
  });
  await new Promise<void>((r) => relay.listen(0, '127.0.0.1', () => r()));
  const origin = `http://localhost:${(relay.address() as net.AddressInfo).port}`;
  try {
    await mockSummary(page);
    await page.addInitScript(() => { (window as { __singletrackExport?: object }).__singletrackExport = { maxFrames: 12, scale: 0.25 }; });
    await openSummary(page, origin);
    await page.getByTestId('summary-export-open').click();
    await expect(page.getByTestId('summary-export')).toBeVisible();
    await expect(page.getByTestId('summary-playpause')).toHaveAccessibleName(/Lecture|Play/);
    await page.getByTestId('summary-export-portrait').click();
    // Speed (#1711): ×2 by default, ×6 makes the film shorter.
    const len = page.getByTestId('summary-export-duration');
    await expect(page.getByTestId('summary-export-speed-2')).toHaveAttribute('aria-pressed', 'true');
    const at2 = await len.textContent();
    await page.getByTestId('summary-export-speed-6').click();
    await expect(len).not.toHaveText(at2!);
    await page.getByTestId('summary-export-run').click();
    const link = page.getByTestId('summary-export-download');
    await expect(link).toBeVisible({ timeout: 120_000 });
    const download = await Promise.all([page.waitForEvent('download'), link.click()]).then(([d]) => d);
    expect(download.suggestedFilename()).toMatch(/^singletrack-\d{4}-\d{2}-\d{2}\.mp4$/);
    const buf = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c));
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(4, 8).toString('ascii')).toBe('ftyp');
    await download.saveAs(test.info().outputPath('export.mp4'));
  } finally {
    relay.close();
  }
});
