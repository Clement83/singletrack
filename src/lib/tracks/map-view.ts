/** Map view (zoom + centre) in the URL (`?z=12.5&lat=43.1234&lng=6.1234`, #1577): shareable, restored on return. */
export type MapView = { z: number; lat: number; lng: number };

export const VIEW_PARAMS = ['z', 'lat', 'lng', 't'] as const;

const round = (n: number, d: number) => Number(n.toFixed(d));

/** Reads `z`, `lat`, `lng`; `null` if missing or invalid (default view). */
export function parseMapView(sp: URLSearchParams): MapView | null {
  const get = (k: string) => {
    const v = sp.get(k);
    return v === null || v.trim() === '' ? NaN : Number(v);
  };
  const z = get('z'), lat = get('lat'), lng = get('lng');
  if (![z, lat, lng].every(Number.isFinite)) return null;
  if (z < 0 || z > 22 || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { z: round(z, 2), lat: round(lat, 4), lng: round(lng, 4) };
}

/** Sets the view (centre with 4 decimals, zoom with 2) in the parameters. */
export function writeMapView(params: URLSearchParams, v: MapView): URLSearchParams {
  params.set('z', String(round(v.z, 2)));
  params.set('lat', String(round(v.lat, 4)));
  params.set('lng', String(round(v.lng, 4)));
  return params;
}

/** Slug of the open track (`t`), empty if absent. */
export function parseOpenTrack(sp: URLSearchParams): string | null {
  const t = sp.get('t')?.trim();
  return t && /^[0-9a-f-]{8,64}$/i.test(t) ? t : null;
}

/** True if the view moved enough to justify a URL update (avoids map ↔ URL loops). */
export function viewChanged(a: MapView | null, b: MapView): boolean {
  if (!a) return true;
  return Math.abs(a.z - b.z) >= 0.01 || Math.abs(a.lat - b.lat) >= 0.00005 || Math.abs(a.lng - b.lng) >= 0.00005;
}

/** View parameters only, for links ("New track", "Back"). */
export function viewQuery(v: MapView | null, openSlug?: string | null): string {
  if (!v) return '';
  const p = writeMapView(new URLSearchParams(), v);
  if (openSlug) p.set('t', openSlug);
  return p.toString();
}

/** MapLibre padding (px) = the part of the map hidden by a floating panel (#1689). */
export type MapPadding = { top: number; right: number; bottom: number; left: number };

export const NO_PADDING: MapPadding = { top: 0, right: 0, bottom: 0, left: 0 };

/** Desktop side panel: left offset (rail + margin), width (`--spacing-rail` 80, `--spacing-panel` 400) and gap to the visible area. */
export const DESKTOP_PANEL = { left: 92, width: 400, gap: 12 } as const;
/** A sheet at the top detent would leave no map: the padding never exceeds this share of the height. */
export const MAX_SHEET_SHARE = 0.6;

/**
 * Padding to give the map (`setPadding` / `easeTo({ padding })`) so that its centre, and every fit, falls in the
 * VISIBLE area: desktop = panel width + margins on the left, mobile = sheet height at the current detent
 * (`'148px'` or a share of the viewport, as in `SNAP_POINTS`) at the bottom. Without an open panel: none.
 * A single mechanism: `fitBounds`/`easeTo`/`panTo` calls add only their own small margins on top.
 */
export function floatingPadding(o: { desktop: boolean; panelOpen: boolean; viewportHeight: number; snap?: string | number | null }): MapPadding {
  if (!o.panelOpen) return NO_PADDING;
  if (o.desktop) return { ...NO_PADDING, left: DESKTOP_PANEL.left + DESKTOP_PANEL.width + DESKTOP_PANEL.gap };
  const snap = o.snap ?? 0.5;
  const px = typeof snap === 'number' ? snap * o.viewportHeight : Number.parseFloat(snap) || 0;
  return { ...NO_PADDING, bottom: Math.round(Math.min(Math.max(px, 0), o.viewportHeight * MAX_SHEET_SHARE)) };
}

export function samePadding(a: Partial<MapPadding>, b: MapPadding): boolean {
  return (a.top ?? 0) === b.top && (a.right ?? 0) === b.right && (a.bottom ?? 0) === b.bottom && (a.left ?? 0) === b.left;
}
