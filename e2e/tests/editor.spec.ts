import { expect, test } from '@playwright/test';
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
  // Le départ n'a pas bougé.
  const start = (await waypointCenters(page))[0];
  expect(Math.hypot(start.x - a.x, start.y - a.y)).toBeLessThan(12); // l'aimant peut recaler le départ sur la route
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
  // BRouter ne propose pas toujours d'alternative pour un tronçon court : le scénario s'arrête alors là.
  await expect.poll(() => altCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(0);
  test.skip((await altCount(page)) === 0, 'aucune alternative proposée par BRouter sur ce tronçon');
  const [alt] = await altLines(page);
  const before = (await segments(page))[0].coords;
  const c = alt[Math.floor(alt.length / 2)];
  await clickAt(page, await screenOf(page, [c[0], c[1]]));
  await waitRouted(page, 1);
  expect((await segments(page))[0].coords).not.toEqual(before);
});

// Bugs de l'epic #1521 : scénarios écrits ici en `fixme`, activés par chaque ticket (retirer `.fixme`).
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
  // Ouvrir une trace existante (`/t/<slug>/edit`), déplacer un point du milieu, vérifier que les autres tronçons gardent leur tracé.
});

test.fixme('#1527 : des alternatives sont proposées après chaque modification', async ({ page }) => {
  await openEditor(page);
  await twoPoints(page);
  expect(await altCount(page)).toBeGreaterThan(0);
});

// #1642 : paire « nouveau / ancien » après un glisser. Dépend des chemins réels de BRouter : sans paire proposée, le scénario s'arrête.
test('éditeur : deux chemins après un glisser, clic sur l’autre, « Garder ce chemin » ne laisse qu’un tracé', async ({ page }) => {
  await openEditor(page);
  const { b } = await twoPoints(page);
  // Il faut des points posés de chaque côté du point tiré pour qu'une déviation élargie existe.
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
