// Sharing an outing (#1351): directions links to the meeting point, file name. Pure logic, tested.

export type MapApp = 'google' | 'waze' | 'apple';
export const MAP_APPS: MapApp[] = ['google', 'waze', 'apple'];

/** Directions to the meeting point in the chosen maps app (opens the app on a phone, the website otherwise). */
export function directionsLinks(lat: number, lon: number): Record<MapApp, string> {
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${ll}`,
    waze: `https://waze.com/ul?ll=${ll}&navigate=yes`,
    apple: `https://maps.apple.com/?daddr=${ll}&dirflg=d`,
  };
}

/** Safe file name (no accents or special characters), at most 60 characters. */
export function safeFileName(title: string, fallback = 'sortie'): string {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return base || fallback;
}
