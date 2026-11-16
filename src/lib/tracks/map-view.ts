/** Vue de la carte (zoom + centre) dans l'URL (`?z=12.5&lat=43.1234&lng=6.1234`, #1577) : partageable, reprise au retour. */
export type MapView = { z: number; lat: number; lng: number };

export const VIEW_PARAMS = ['z', 'lat', 'lng', 't'] as const;

const round = (n: number, d: number) => Number(n.toFixed(d));

/** Lit `z`, `lat`, `lng` ; `null` si absents ou invalides (vue par défaut). */
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

/** Pose la vue (centre à 4 décimales, zoom à 2) dans les paramètres. */
export function writeMapView(params: URLSearchParams, v: MapView): URLSearchParams {
  params.set('z', String(round(v.z, 2)));
  params.set('lat', String(round(v.lat, 4)));
  params.set('lng', String(round(v.lng, 4)));
  return params;
}

/** Slug de la trace ouverte (`t`), vide si absent. */
export function parseOpenTrack(sp: URLSearchParams): string | null {
  const t = sp.get('t')?.trim();
  return t && /^[0-9a-f-]{8,64}$/i.test(t) ? t : null;
}

/** Vrai si la vue a assez bougé pour justifier une mise à jour de l'URL (évite les boucles carte ↔ URL). */
export function viewChanged(a: MapView | null, b: MapView): boolean {
  if (!a) return true;
  return Math.abs(a.z - b.z) >= 0.01 || Math.abs(a.lat - b.lat) >= 0.00005 || Math.abs(a.lng - b.lng) >= 0.00005;
}

/** Paramètres de vue seuls, pour les liens (« Nouvelle trace », « Retour »). */
export function viewQuery(v: MapView | null, openSlug?: string | null): string {
  if (!v) return '';
  const p = writeMapView(new URLSearchParams(), v);
  if (openSlug) p.set('t', openSlug);
  return p.toString();
}
