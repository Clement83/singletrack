// Sans dépendance serveur : importé aussi par le formulaire client.
/** Origines proposées au formulaire. `perso` = trace faite par l'utilisateur (aucune attribution requise). */
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

