import { expect, test, type Page } from '@playwright/test';

// Track map: sheet in the panel (#1582), preview on hover (#1583), no more multi-selection (#1584). The data is mocked (start points + geometries): the test
// does not depend on the database content. Desktop mouse; mobile touch will come with #1537.
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

// #1582: a start point or a list row opens the sheet **in the panel** (no navigation), line and profile included.
const sheetOf = (s: ReturnType<typeof mk>) => {
  const [x, y] = s.start as number[];
  const coords = [[x, y, 100], [x + 0.005, y + 0.005, 180], [x + 0.01, y + 0.01, 140]];
  return {
    slug: s.slug, name: s.name, status: 'published', difficulty: 'blue', loop: true, source: 'osm', distanceM: 1400, gainM: 80, lossM: 40, minEle: 100, maxEle: 180, durationMin: 20,
    description: null, author: 'Alice', license: 'ODbL', attribution: '© OpenStreetMap', sourceUrl: null,
    geometry: { type: 'LineString', coordinates: coords }, bbox: [x, y, x + 0.01, y + 0.01], start: [x, y], end: [x + 0.01, y + 0.01],
    profile: coords.map((c, i) => ({ distKm: i * 0.7, ele: c[2], lon: c[0], lat: c[1] })),
    rights: { edit: false, copy: true, delete: false }, outings: [],
  };
};

test('panneau : un départ commun liste ses traces, une ligne ouvre la fiche sans quitter la carte, Retour', async ({ page }) => {
  await load(page, '/');
  const c = await page.evaluate(() => (window as unknown as Win).__explorerMap!.getCenter());
  // Two tracks at the same car park, a third one alone.
  const starts = [mk('e2e-a', c.lng - 0.03, c.lat), mk('e2e-b', c.lng - 0.03, c.lat), mk('e2e-c', c.lng + 0.03, c.lat)];
  await page.route(/\/api\/tracks\?.*starts=1/, (r) => r.fulfill({ json: { tracks: starts, total: 3 } }));
  await page.route(/\/api\/tracks\/e2e-[a-z]$/, (r) => r.fulfill({ json: sheetOf(starts.find((x) => r.request().url().endsWith(x.slug))!) }));
  await load(page, '/?q=e2e');
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!;
  const tap = async (slug: string) => {
    const s = starts.find((x) => x.slug === slug)!;
    const p = await page.evaluate((ll) => (window as unknown as Win).__explorerMap!.project(ll), s.start);
    await page.mouse.click(box.x + p.x, box.y + p.y);
  };
  const openLine = () => page.evaluate(() => (window as unknown as Win).__explorerMap!.querySourceFeatures('open').length);

  await expect(page.getByRole('button', { name: /traces?$/ }).first()).toBeVisible();
  // Shared start: the list of tracks from here (cluster or stacked markers).
  await tap('e2e-a');
  await expect(page.getByRole('heading', { name: '2 traces partent d’ici' })).toBeVisible();
  // #1585: the slope legend is on the map only while a track is open.
  const legend = page.getByRole('button', { name: 'Pentes' });
  await expect(legend).toHaveCount(0);
  await page.getByRole('button', { name: /e2e-b/ }).click();
  await expect(legend).toBeVisible();
  const panel = page.getByTestId('track-panel');
  await expect(panel.getByText(/1,4\s*km/)).toBeVisible();
  await expect(page).toHaveURL(/^[^?]*\/\?(.*&)?t=e2e-b/);
  await expect.poll(openLine).toBeGreaterThan(0);
  const footer = page.getByTestId('track-panel-footer');
  await expect(footer.getByRole('slider')).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Télécharger le GPX' })).toHaveAttribute('href', '/api/t/e2e-b/gpx');
  await expect(footer.getByRole('link', { name: /Préparer une sortie/ })).toHaveAttribute('href', '/sorties/nouvelle?trace=e2e-b');
  // Sources behind the "?".
  await panel.getByRole('button', { name: /D’où vient cette trace/ }).click();
  await expect(panel.getByText('© OpenStreetMap')).toBeVisible();
  // Back to the group.
  await panel.getByRole('button', { name: 'Les traces d’ici' }).click();
  await expect(page.getByRole('heading', { name: '2 traces partent d’ici' })).toBeVisible();
  // Single start: the sheet opens directly.
  await tap('e2e-c');
  await expect(page).toHaveURL(/t=e2e-c/);
  await expect(page.getByTestId('track-panel').getByText(/1,4\s*km/)).toBeVisible();
});

// #1583: hovering a row of the group → dimmed preview of its track on the map, removed when leaving the row.
test('survol : une ligne de liste montre sa trace en aperçu sur la carte', async ({ page }) => {
  await load(page, '/');
  const c = await page.evaluate(() => (window as unknown as Win).__explorerMap!.getCenter());
  const starts = [mk('e2e-a', c.lng, c.lat), mk('e2e-b', c.lng, c.lat)];
  await page.route(/\/api\/tracks\?.*starts=1/, (r) => r.fulfill({ json: { tracks: starts, total: 2 } }));
  await page.route(/\/api\/tracks\/geometry/, (r) => {
    const slugs = new URL(r.request().url()).searchParams.get('slugs')!.split(',');
    return r.fulfill({ json: { tracks: slugs.map((slug) => ({ slug, geometry: { type: 'LineString', coordinates: [[c.lng, c.lat], [c.lng + 0.01, c.lat + 0.01]] } })) } });
  });
  await load(page, '/?q=e2e');
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!;
  const p = await page.evaluate((ll) => (window as unknown as Win).__explorerMap!.project(ll), starts[0].start);
  await page.mouse.click(box.x + p.x, box.y + p.y);
  await expect(page.getByRole('heading', { name: '2 traces partent d’ici' })).toBeVisible();
  const preview = () => page.evaluate(() => (window as unknown as Win).__explorerMap!.querySourceFeatures('preview').length);
  expect(await preview()).toBe(0);
  await page.getByRole('button', { name: /e2e-b/ }).hover();
  await expect.poll(preview).toBeGreaterThan(0);
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10);
  await expect.poll(preview).toBe(0);
  // No opening and no URL change on hover.
  await expect(page).not.toHaveURL(/t=e2e-b/);
});

// #1584: no more multi-selection. A row of "In this area" opens the sheet (Back = the whole list);
// an old `?sel=` link opens normally and the parameter disappears.
test('liste : une ligne ouvre la fiche, Retour revient à la liste, ancien ?sel= ignoré', async ({ page }) => {
  await load(page, '/');
  const c = await page.evaluate(() => (window as unknown as Win).__explorerMap!.getCenter());
  const starts = [mk('e2e-a', c.lng - 0.03, c.lat), mk('e2e-b', c.lng + 0.03, c.lat)];
  await page.route(/\/api\/tracks\?.*starts=1/, (r) => r.fulfill({ json: { tracks: starts, total: 2 } }));
  await page.route(/\/api\/tracks\/e2e-[a-z]$/, (r) => r.fulfill({ json: sheetOf(starts.find((x) => r.request().url().endsWith(x.slug))!) }));
  await load(page, '/?q=e2e&sel=e2e-a');
  await expect(page).not.toHaveURL(/sel=/);
  await page.getByRole('button', { name: /^\d+ traces?$/ }).click();
  await expect(page.getByRole('button', { name: /Ajouter .* à la sélection/ })).toHaveCount(0);
  // #1585: the slope legend only appears on the map with an open track.
  const legend = page.getByRole('button', { name: /^Pentes/ });
  await expect(legend).toHaveCount(0);
  await page.getByRole('button', { name: /e2e-a/ }).click();
  await expect(legend).toBeVisible();
  await legend.click();
  await expect(legend).toHaveAttribute('aria-expanded', 'true');
  await expect(page).toHaveURL(/t=e2e-a/);
  const panel = page.getByTestId('track-panel');
  await expect(panel.getByText(/1,4\s*km/)).toBeVisible();
  await panel.getByRole('button', { name: 'Toutes les traces' }).click();
  await expect(page.getByRole('heading', { name: 'Traces sur la carte' })).toBeVisible();
});

// #1607: no MapLibre error "Cannot add layer … before non-existing layer"; start points above the preview and the open track.
test('carte : pas d’erreur « non-existing layer » et départs au-dessus de la trace ouverte', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (/non-existing layer/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => { if (/non-existing layer/.test(e.message)) errors.push(e.message); });
  await load(page, '/');
  const c = await page.evaluate(() => (window as unknown as Win).__explorerMap!.getCenter());
  const starts = [mk('e2e-a', c.lng, c.lat)];
  await page.route(/\/api\/tracks\?.*starts=1/, (r) => r.fulfill({ json: { tracks: starts, total: 1 } }));
  await page.route(/\/api\/tracks\/e2e-a$/, (r) => r.fulfill({ json: sheetOf(starts[0]) }));
  await load(page, '/?q=e2e');
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!;
  const p = await page.evaluate((ll) => (window as unknown as Win).__explorerMap!.project(ll), starts[0].start);
  await expect(page.getByRole('button', { name: /traces?$/ }).first()).toBeVisible();
  await page.mouse.click(box.x + p.x, box.y + p.y);
  await page.waitForFunction(() => (window as unknown as Win).__explorerMap!.querySourceFeatures('open').length > 0);
  const order = await page.evaluate(() => (window as unknown as { __explorerMap: { getStyle(): { layers: { id: string }[] } } }).__explorerMap.getStyle().layers.map((l) => l.id));
  expect(order.indexOf('open-line')).toBeLessThan(order.indexOf('clusters'));
  expect(order.indexOf('preview-line')).toBeLessThan(order.indexOf('clusters'));
  expect(errors).toEqual([]);
});
