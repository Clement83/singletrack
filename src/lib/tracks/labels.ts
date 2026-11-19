import type { TrackSourceId } from './types';

/** Libellés d'affichage des sources (attribution détaillée : champ `attribution` de la trace). */
export const SOURCE_LABEL: Record<TrackSourceId, string> = {
  utagawa: 'UtagawaVTT',
  osm: 'OpenStreetMap',
  geotrek: 'Circuits officiels',
  gpx: 'Import GPX',
  manual: 'Trace maison',
  edited: 'Trace modifiée',
  datatourisme: 'Offices de tourisme (DATAtourisme)',
};
