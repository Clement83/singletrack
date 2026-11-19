import type { TrackSourceId } from './types';

/** Display labels of the sources (detailed attribution: the track's `attribution` field). */
export const SOURCE_LABEL: Record<TrackSourceId, string> = {
  utagawa: 'UtagawaVTT',
  osm: 'OpenStreetMap',
  geotrek: 'Circuits officiels',
  gpx: 'Import GPX',
  manual: 'Trace maison',
  edited: 'Trace modifiée',
  datatourisme: 'Offices de tourisme (DATAtourisme)',
};
