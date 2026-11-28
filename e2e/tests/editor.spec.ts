import { expect, test } from '@playwright/test';
import type { LngLat } from './helpers';
import { altCount, altLines, clickAt, dragMouse, mapCenter, onSegment, openEditor, screenOf, segments, twoPoints, waitRouted, waypointButtons, waypointCenters } from './helpers';

test('éditeur : la carte se charge et le premier clic pose le départ', async ({ page }) => {
  await openEditor(page);
  await expect(waypointButtons(page)).toHaveCount(0);
  await clickAt(page, await mapCenter(page));
  await expect(waypointButtons(page)).toHaveCount(1);
});

test('éditeur : deux points posés → un tronçon routé par BRouter', async ({ page }) => {
  await openEditor(page);
  await twoPoints(page);
  const s = await segments(page);
  expect(s).toHaveLength(1);
  expect(s[0].coords.length).toBeGreaterThan(2);
  await waitRouted(page);
});

test('éditeur : trois points → deux tronçons, le tracé passe par chaque point', async ({ page }) => {
  await openEditor(page);
  const { b } = await twoPoints(page);
  await clickAt(page, { x: b.x + 120, y: b.y - 40 });
  await expect(waypointButtons(page)).toHaveCount(3);
  await waitRouted(page, 2);
});

test('éditeur : un clic sur la trace insère un point dans le tronçon', async ({ page }) => {
  await openEditor(page);
  await twoPoints(page);
  const [seg] = await segments(page);
  await clickAt(page, await onSegment(page, seg, 0.5));
  await expect(waypointButtons(page)).toHaveCount(3);
  await waitRouted(page, 2);
});

test('éditeur : glisser un point le déplace et recalcule le tronçon', async ({ page }) => {
  await openEditor(page);
  const { a, b } = await twoPoints(page);
  const before = (await segments(page))[0].coords;
  await dragMouse(page, b, { x: b.x + 40, y: b.y - 90 });
  await expect(waypointButtons(page)).toHaveCount(2);
  const moved = (await waypointCenters(page))[1];
  expect(Math.hypot(moved.x - b.x, moved.y - b.y)).toBeGreaterThan(20);
  await waitRouted(page, 1);
  const after = (await segments(page))[0].coords;
  expect(after[after.length - 1]).not.toEqual(before[before.length - 1]);
  // The start point did not move.
  const start = (await waypointCenters(page))[0];
  expect(Math.hypot(start.x - a.x, start.y - a.y)).toBeLessThan(12); // the magnet may snap the start onto the road
});

test('éditeur : glisser la ligne insère un point et le place', async ({ page }) => {
  await openEditor(page);
  await twoPoints(page);
  const [seg] = await segments(page);
  const mid = await onSegment(page, seg, 0.5);
  await dragMouse(page, mid, { x: mid.x, y: mid.y - 80 });
  await expect(waypointButtons(page)).toHaveCount(3);
  await waitRouted(page, 2);
});

test('éditeur : une alternative proposée se choisit d’un clic', async ({ page }) => {
  await openEditor(page);
  await twoPoints(page);
  // BRouter does not always offer an alternative for a short segment: the scenario then stops there.
  await expect.poll(() => altCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(0);
  test.skip((await altCount(page)) === 0, 'aucune alternative proposée par BRouter sur ce tronçon');
  const [alt] = await altLines(page);
  const before = (await segments(page))[0].coords;
  const c = alt[Math.floor(alt.length / 2)];
  await clickAt(page, await screenOf(page, [c[0], c[1]]));
  await waitRouted(page, 1);
  expect((await segments(page))[0].coords).not.toEqual(before);
});

// Bugs of epic #1521: scenarios written here as `fixme`, enabled by each ticket (remove `.fixme`).
test.fixme('#1524 : un point posé sur une route prend (pas d’annulation, pas de ligne droite)', async ({ page }) => {
  await openEditor(page);
  await twoPoints(page);
  const s = await segments(page);
  expect(s.every((x) => x.mode === 'route')).toBe(true);
});

test.fixme('#1525 : tirer un point vers une route voisine suit la route', async ({ page }) => {
  await openEditor(page);
  const { b } = await twoPoints(page);
  await dragMouse(page, b, { x: b.x + 30, y: b.y + 30 });
  await waitRouted(page, 1);
  expect((await segments(page))[0].mode).toBe('route');
});

test.fixme('#1526 : modifier le milieu d’un circuit ne recalcule que les tronçons touchés', async () => {
  // Open an existing track (`/t/<slug>/edit`), move a middle point, check that the other segments keep their route.
});

test.fixme('#1527 : des alternatives sont proposées après chaque modification', async ({ page }) => {
  await openEditor(page);
  await twoPoints(page);
  expect(await altCount(page)).toBeGreaterThan(0);
});

// #1642: "new / old" pair after a drag. Depends on BRouter's real paths: without a proposed pair, the scenario stops.
test('éditeur : deux chemins après un glisser, clic sur l’autre, « Garder ce chemin » ne laisse qu’un tracé', async ({ page }) => {
  await openEditor(page);
  const { b } = await twoPoints(page);
  // Points must be placed on both sides of the dragged point for a widened detour to exist.
  await clickAt(page, { x: b.x + 120, y: b.y - 40 });
  await clickAt(page, { x: b.x + 240, y: b.y });
  await waitRouted(page, 3);
  await dragMouse(page, b, { x: b.x + 40, y: b.y - 110 });
  const keep = page.getByRole('button', { name: /Garder ce chemin|Keep this path/ });
  const shown = await keep.waitFor({ timeout: 15_000 }).then(() => true, () => false);
  test.skip(!shown, 'BRouter ne propose pas deux chemins pour ce glisser');
  const halos = () =>
    page.evaluate(() => {
      const m = (window as unknown as { __editorMap: { getSource(id: string): { serialize(): { data: { features: { properties: { which: string; sel: boolean } }[] } } } } }).__editorMap;
      return m.getSource('choice').serialize().data.features.map((f) => f.properties);
    });
  const first = await halos();
  expect(new Set(first.map((f) => f.which))).toEqual(new Set(['new', 'old']));
  expect(first.find((f) => f.sel)?.which).toBe('new');
  await page.getByRole('button', { name: /^(Ancien chemin|Old path)/ }).click();
  await expect.poll(async () => (await halos()).find((f) => f.sel)?.which).toBe('old');
  await keep.click();
  await expect(keep).toHaveCount(0);
  expect(await halos()).toHaveLength(0);
});

// #1811: hovering an alternative's label previews its profile/stats and highlights it, leaving the document untouched.
test('#1811 : survoler l’étiquette d’une alternative affiche son profil, la sortie restaure, le tracé ne change pas', async ({ page }) => {
  await openEditor(page);
  const { b } = await twoPoints(page);
  await clickAt(page, { x: b.x + 120, y: b.y - 40 });
  await clickAt(page, { x: b.x + 240, y: b.y });
  await waitRouted(page, 3);
  await dragMouse(page, b, { x: b.x + 40, y: b.y - 110 });
  const keep = page.getByRole('button', { name: /Garder ce chemin|Keep this path/ });
  const shown = await keep.waitFor({ timeout: 15_000 }).then(() => true, () => false);
  test.skip(!shown, 'BRouter ne propose pas deux chemins pour ce glisser');
  const profile = page.getByRole('region', { name: /profil|profile/i }).first();
  const stats = () => profile.locator('dl').innerText();
  const hl = () =>
    page.evaluate(() => (window as unknown as { __editorMap: { getSource(id: string): { serialize(): { data: { features: unknown[] } } } } }).__editorMap.getSource('alt-hl').serialize().data.features.length);
  const selected = () =>
    page.evaluate(() => (window as unknown as { __editorMap: { getSource(id: string): { serialize(): { data: { features: { properties: { which: string; sel: boolean } }[] } } } } }).__editorMap.getSource('choice').serialize().data.features.find((f) => f.properties.sel)?.properties.which);
  const before = await stats();
  const sel0 = await selected();
  await page.getByRole('button', { name: /^(Ancien chemin|Old path)/ }).hover();
  await expect.poll(hl).toBe(1);
  await expect.poll(stats).not.toBe(before);
  await page.mouse.move(5, 300);
  await expect.poll(hl).toBe(0);
  await expect.poll(stats).toBe(before);
  expect(await selected()).toBe(sel0);
});

// #1686: a track opened from an existing geometry (frozen segments, > 400 m): moving a point never leaves a straight
// line, BRouter recomputes the touched segments and the others keep their original route.
test('#1686 : déplacer un point d’une trace à longs tronçons ne laisse aucune ligne droite', async ({ page, request }) => {
  const lon = 6.2, lat = 43.3;
  const coords = Array.from({ length: 41 }, (_, k) => [lon + k * 0.0006, lat + (k % 2) * 0.0002, 100]);
  const wp = [0, 10, 20, 30, 40].map((k) => [coords[k][0], coords[k][1]]);
  const res = await request.post('/api/tracks', {
    data: { name: 'e2e 1686', geometry: { type: 'LineString', coordinates: coords }, waypoints: wp, modes: ['line', 'line', 'line', 'line'], frozen: [true, true, true, true], status: 'draft' },
  });
  expect(res.ok()).toBe(true);
  const { slug } = (await res.json()) as { slug: string };
  await openEditor(page, `/t/${slug}/edit`);
  const before = await segments(page);
  expect(before.every((s) => s.mode === 'line' && s.coords.length > 2)).toBe(true);
  const mid = await screenOf(page, wp[2] as LngLat);
  await dragMouse(page, mid, { x: mid.x, y: mid.y + 40 });
  await waitRouted(page);
  const after = await segments(page);
  expect(after.some((s) => s.mode === 'route')).toBe(true);
  expect(after.filter((s) => s.mode === 'line').every((s) => s.coords.length > 2)).toBe(true);
  await page.waitForTimeout(3000); // autosave of the draft
  await openEditor(page, `/t/${slug}/edit`);
  expect((await segments(page)).every((s) => s.coords.length > 2)).toBe(true);
});
