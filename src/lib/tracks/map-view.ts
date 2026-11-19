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
