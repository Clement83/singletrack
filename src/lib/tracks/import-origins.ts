// No server dependency: also imported by the client form.
/** Origins offered by the form. `perso` = track made by the user (no attribution required). */
export const IMPORT_ORIGINS = [
  { id: 'perso', label: 'Ma propre trace', credit: null },
  { id: 'utagawa', label: 'UtagawaVTT', credit: 'Source : UtagawaVTT.com' },
  { id: 'visorando', label: 'Visorando', credit: 'Source : Visorando' },
  { id: 'openrunner', label: 'OpenRunner', credit: 'Source : OpenRunner' },
  { id: 'strava', label: 'Strava', credit: 'Source : Strava' },
  { id: 'komoot', label: 'Komoot', credit: 'Source : Komoot' },
  { id: 'autre', label: 'Autre source', credit: 'Source : ' },
] as const;
export type ImportOriginId = (typeof IMPORT_ORIGINS)[number]['id'];

