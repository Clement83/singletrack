// Partage d'une sortie (#1351) : liens d'itinéraire vers le RDV, nom de fichier. Logique pure, testée.

export type MapApp = 'google' | 'waze' | 'apple';
export const MAP_APPS: MapApp[] = ['google', 'waze', 'apple'];

/** Itinéraire vers le RDV dans l'appli de cartes choisie (ouvre l'appli sur téléphone, le site sinon). */
export function directionsLinks(lat: number, lon: number): Record<MapApp, string> {
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${ll}`,
    waze: `https://waze.com/ul?ll=${ll}&navigate=yes`,
    apple: `https://maps.apple.com/?daddr=${ll}&dirflg=d`,
  };
}

/** Nom de fichier sûr (sans accents ni caractères spéciaux), 60 caractères au plus. */
export function safeFileName(title: string, fallback = 'sortie'): string {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return base || fallback;
}
