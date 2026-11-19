import { expect, type Page } from '@playwright/test';

/** Page pixels of a point (lng, lat), through the projection of the real MapLibre map. */
export type Pt = { x: number; y: number };
export type LngLat = [number, number];
export type EditSegment = { seg: number; mode: string; coords: number[][] };

/** OpenTopoMap tiles are external: blank background, for fast, deterministic, offline tests. */
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Opens the editor (`/new` or `/t/<slug>/edit`) and waits for the map to load. */
export async function openEditor(page: Page, url = '/new') {
  await page.route(/tile\.opentopomap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));
  // Exposes the map (`window.__editorMap`, see track-editor.tsx) for tests only.
  await page.addInitScript(() => { (window as unknown as { __E2E__: boolean }).__E2E__ = true; });
  await page.goto(url);
  await page.waitForFunction(() => {
    const m = (window as unknown as { __editorMap?: { isStyleLoaded(): boolean } }).__editorMap;
    return !!m && m.isStyleLoaded();
  }, undefined, { timeout: 60_000 });
}

/** Screen (page) position of a geographic point. */
export async function screenOf(page: Page, p: LngLat): Promise<Pt> {
  const box = await page.locator('.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('carte absente');
  const pt = await page.evaluate((ll) => {
    const m = (window as unknown as { __editorMap: { project(l: number[]): { x: number; y: number } } }).__editorMap;
    return m.project(ll);
  }, p);
  return { x: box.x + pt.x, y: box.y + pt.y };
}

/** Geographic position of a page point. */
export async function lngLatOf(page: Page, pt: Pt): Promise<LngLat> {
  const box = await page.locator('.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('carte absente');
  return page.evaluate((p) => {
    const m = (window as unknown as { __editorMap: { unproject(p: number[]): { lng: number; lat: number } } }).__editorMap;
    const l = m.unproject(p);
    return [l.lng, l.lat] as [number, number];
  }, [pt.x - box.x, pt.y - box.y]);
}

/** Map centre (home point). */
export async function mapCenter(page: Page): Promise<Pt> {
  const box = await page.locator('.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('carte absente');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Segments of the track (`edit` source): line of each segment, as drawn. */
export async function segments(page: Page): Promise<EditSegment[]> {
  return page.evaluate(() => {
    const m = (window as unknown as { __editorMap: { getSource(id: string): { serialize(): { data: { features: { properties: { seg: number; mode: string }; geometry: { coordinates: number[][] } }[] } } } } }).__editorMap;
    return m.getSource('edit').serialize().data.features.map((f) => ({ seg: f.properties.seg, mode: f.properties.mode, coords: f.geometry.coordinates }));
  });
}

/** Displayed alternatives (`alts` source). */
export async function altCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = (window as unknown as { __editorMap: { getSource(id: string): { serialize(): { data: { features: unknown[] } } } } }).__editorMap;
    return m.getSource('alts').serialize().data.features.length;
  });
}

/** Lines of the displayed alternatives (`alts` source), as drawn. */
export async function altLines(page: Page): Promise<number[][][]> {
  return page.evaluate(() => {
    const m = (window as unknown as { __editorMap: { getSource(id: string): { serialize(): { data: { features: { geometry: { coordinates: number[][] } }[] } } } } }).__editorMap;
    return m.getSource('alts').serialize().data.features.map((f) => f.geometry.coordinates);
  });
}

export const waypointButtons = (page: Page) => page.locator('[data-waypoint]');

/** Screen positions of the placed points, in order. */
export async function waypointCenters(page: Page): Promise<Pt[]> {
  const out: Pt[] = [];
  const n = await waypointButtons(page).count();
  for (let i = 0; i < n; i++) {
    const b = await waypointButtons(page).nth(i).boundingBox();
    if (b) out.push({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }
  return out;
}

/** Waits until every routed segment has its BRouter line (more than the 2 end points of the temporary straight line). */
export async function waitRouted(page: Page, count?: number) {
  await expect
    .poll(async () => {
      const s = await segments(page);
      return s.length > 0 && (count === undefined || s.length === count) && s.every((x) => x.mode !== 'route' || x.coords.length > 2);
    }, { timeout: 45_000, message: 'tracé BRouter reçu' })
    .toBe(true);
}

/** Mouse click on the map at a page point. */
export async function clickAt(page: Page, p: Pt) {
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

/** Mouse drag from `a` to `b` in several steps (the intermediate `mousemove` events matter). */
export async function dragMouse(page: Page, a: Pt, b: Pt, steps = 12) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

/** Point of a segment's line at fraction `f` of its vertices, in page pixels. */
export async function onSegment(page: Page, seg: EditSegment, f = 0.5): Promise<Pt> {
  const c = seg.coords[Math.round((seg.coords.length - 1) * f)];
  return screenOf(page, [c[0], c[1]]);
}

/** Places two points `dx` px apart (A at centre − dx/2, B at centre + dx/2) and waits for the routed line. */
export async function twoPoints(page: Page, dx = 260) {
  const c = await mapCenter(page);
  const a = { x: c.x - dx / 2, y: c.y };
  const b = { x: c.x + dx / 2, y: c.y };
  await clickAt(page, a);
  await clickAt(page, b);
  await expect(waypointButtons(page)).toHaveCount(2);
  await waitRouted(page, 1);
  return { a, b };
}
