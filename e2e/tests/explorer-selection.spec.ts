import { expect, test, type Page } from '@playwright/test';

// #1532 : sélection multiple sur la carte des traces. Les données sont simulées (départs + géométries) : le test
// ne dépend pas du contenu de la base. Desktop souris ; le mobile tactile viendra avec #1537.
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

type Win = { __explorerMap?: { isStyleLoaded(): boolean; getCenter(): { lng: number; lat: number }; project(l: number[]): { x: number; y: number }; querySourceFeatures(id: string): { properties: { slug: string } }[] } };

async function load(page: Page, url: string) {
  await page.route(/tile\.opentopomap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));
  await page.addInitScript(() => { (window as unknown as { __E2E__: boolean }).__E2E__ = true; });
  await page.goto(url);
  await page.waitForFunction(() => !!(window as unknown as Win).__explorerMap?.isStyleLoaded(), undefined, { timeout: 60_000 });
}

const mk = (slug: string, lon: number, lat: number) => ({
  slug, name: slug, start: [lon, lat], distanceKm: 10, gainM: 200, difficulty: 'blue', loop: true, source: 'user', status: 'published', bbox: [lon, lat, lon + 0.01, lat + 0.01],
});

test('carte : toucher des départs affiche leurs traces, retoucher les retire, Tout effacer vide', async ({ page }) => {
  await load(page, '/');
  const c = await page.evaluate(() => (window as unknown as Win).__explorerMap!.getCenter());
  const starts = [mk('e2e-a', c.lng - 0.03, c.lat), mk('e2e-b', c.lng + 0.03, c.lat)];
  await page.route(/\/api\/tracks\?.*starts=1/, (r) => r.fulfill({ json: { tracks: starts, total: 2 } }));
  await page.route(/\/api\/tracks\/geometry/, (r) => {
    const slugs = new URL(r.request().url()).searchParams.get('slugs')!.split(',');
    const tracks = slugs.map((slug) => {
      const s = starts.find((x) => x.slug === slug)!;
      return { slug, geometry: { type: 'LineString', coordinates: [s.start, [s.start[0] + 0.01, s.start[1] + 0.01]] } };
    });
    return r.fulfill({ json: { tracks } });
  });
  await load(page, '/?q=e2e');
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!;
  const tap = async (slug: string) => {
    const s = starts.find((x) => x.slug === slug)!;
    const p = await page.evaluate((ll) => (window as unknown as Win).__explorerMap!.project(ll), s.start);
    await page.mouse.click(box.x + p.x, box.y + p.y);
  };
  const lines = () => page.evaluate(() => new Set((window as unknown as Win).__explorerMap!.querySourceFeatures('selected').map((f) => f.properties.slug)).size);

  await expect(page.getByRole('button', { name: /traces?$/ }).first()).toBeVisible();
  await tap('e2e-a');
  await expect(page).toHaveURL(/sel=e2e-a$/);
  await expect.poll(lines).toBe(1);
  await tap('e2e-b');
  await expect(page).toHaveURL(/sel=e2e-a%2Ce2e-b|sel=e2e-a,e2e-b/);
  await expect.poll(lines).toBe(2);
  await tap('e2e-a');
  await expect(page).toHaveURL(/sel=e2e-b$/);
  await expect.poll(lines).toBe(1);
  // Rechargement : la sélection vient de l'URL.
  await load(page, page.url());
  await expect.poll(lines).toBe(1);
  await page.getByRole('button', { name: 'Tout effacer' }).click();
  await expect(page).not.toHaveURL(/sel=/);
  await expect.poll(lines).toBe(0);
});

// #1533 : liste « Traces choisies » synchronisée avec la carte.
test('liste : traces choisies, ajout depuis la liste, retrait, recentrage, survol', async ({ page }) => {
  await load(page, '/');
  const c = await page.evaluate(() => (window as unknown as Win).__explorerMap!.getCenter());
  const starts = [mk('e2e-a', c.lng - 0.03, c.lat), mk('e2e-b', c.lng + 0.03, c.lat)];
  await page.route(/\/api\/tracks\?.*starts=1/, (r) => r.fulfill({ json: { tracks: starts, total: 2 } }));
  await page.route(/\/api\/tracks\/geometry/, (r) => {
    const slugs = new URL(r.request().url()).searchParams.get('slugs')!.split(',');
    const tracks = slugs.map((slug) => {
      const s = starts.find((x) => x.slug === slug)!;
      return { slug, geometry: { type: 'LineString', coordinates: [s.start, [s.start[0] + 0.01, s.start[1] + 0.01]] } };
    });
    return r.fulfill({ json: { tracks } });
  });
  await load(page, '/?q=e2e&sel=e2e-a');
  await page.getByRole('button', { name: /^\d+ traces?$/ }).click();
  const chosen = page.getByTestId('chosen-panel');
  await expect(chosen.locator('li')).toHaveCount(1);
  // Ajout depuis « Dans la zone » : sans quitter la liste.
  await page.getByRole('button', { name: 'Ajouter e2e-b à la sélection' }).click();
  await expect(page).toHaveURL(/sel=e2e-a(%2C|,)e2e-b/);
  await expect(chosen.locator('li')).toHaveCount(2);
  // Recentrer : la carte cadre les deux traces.
  await chosen.getByRole('button', { name: 'Recentrer' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__explorerMap!.getCenter().lng)).toBeCloseTo(c.lng + 0.005, 1);
  // Retrait depuis le panneau.
  await chosen.getByRole('button', { name: 'Retirer e2e-a de la sélection' }).click();
  await expect(page).toHaveURL(/sel=e2e-b$/);
  await expect(chosen.locator('li')).toHaveCount(1);
  // Survol d'une ligne : elle est mise en avant.
  await chosen.locator('li[data-slug="e2e-b"]').hover();
  await expect(chosen.locator('li[data-slug="e2e-b"]')).toHaveClass(/bg-accent/);
});
