/** Sources de données activables par instance (`DATA_SOURCES`, #1473). */
export const DATA_SOURCE_NAMES = ['osm', 'geotrek', 'datatourisme', 'ign', 'openmeteo', 'fire83', 'hunting83'] as const;
export type DataSource = (typeof DATA_SOURCE_NAMES)[number];

/** Liste `DATA_SOURCES` (virgules) ; absente ou vide = toutes les sources. Les noms inconnus sont ignorés. */
export function parseDataSources(raw: string | undefined): Set<DataSource> {
  const wanted = (raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return new Set(DATA_SOURCE_NAMES);
  return new Set(DATA_SOURCE_NAMES.filter((n) => wanted.includes(n)));
}

/** Zones `SYNC_ZONES` (codes de département séparés par des virgules ou espaces) ; vide = aucune restriction. */
export function parseSyncZones(raw: string | undefined): string[] {
  return (raw ?? '').split(/[\s,]+/).filter(Boolean);
}

/** Configuration lue depuis l'environnement (voir .env.example). Défauts neutres : centre de la France. */
export const config = {
  /** Point « maison » : centre de la carte et référence des distances (HOME_LAT / HOME_LON). */
  homeLat: Number(process.env.HOME_LAT ?? 46.6),
  homeLon: Number(process.env.HOME_LON ?? 2.4),
  /** BRouter (#1340) : service `brouter` du docker-compose, jamais exposé. */
  brouterUrl: process.env.BROUTER_URL ?? 'http://brouter:17777',
  /** Lien « Code source » (AGPL §13, #1472) : dépôt public par défaut, à surcharger pour une version modifiée. */
  sourceUrl: process.env.SOURCE_URL || 'https://github.com/Clement83/singletrack',
  /** Version semver de l'application (#1485), injectée au build depuis package.json (next.config.mjs). */
  version: process.env.APP_VERSION || 'dev',
  /** Sources actives (#1473). */
  dataSources: parseDataSources(process.env.DATA_SOURCES),
  /** Départements synchronisés par défaut par les scripts `sync:*` ; vide = toute la France. */
  syncZones: parseSyncZones(process.env.SYNC_ZONES),
};

export function sourceEnabled(name: DataSource): boolean {
  return config.dataSources.has(name);
}
