/** Data sources that can be turned on per instance (`DATA_SOURCES`, #1473). */
export const DATA_SOURCE_NAMES = ['osm', 'geotrek', 'datatourisme', 'ign', 'openmeteo', 'fire83', 'hunting83'] as const;
export type DataSource = (typeof DATA_SOURCE_NAMES)[number];

/** `DATA_SOURCES` list (commas); missing or empty = every source. Unknown names are ignored. */
export function parseDataSources(raw: string | undefined): Set<DataSource> {
  const wanted = (raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return new Set(DATA_SOURCE_NAMES);
  return new Set(DATA_SOURCE_NAMES.filter((n) => wanted.includes(n)));
}

/** `SYNC_ZONES` areas (department codes separated by commas or spaces); empty = no restriction. */
export function parseSyncZones(raw: string | undefined): string[] {
  return (raw ?? '').split(/[\s,]+/).filter(Boolean);
}

/** Configuration read from the environment (see .env.example). Neutral defaults: centre of France. */
export const config = {
  /** "Home" point: map centre and reference for distances (HOME_LAT / HOME_LON). */
  homeLat: Number(process.env.HOME_LAT ?? 46.6),
  homeLon: Number(process.env.HOME_LON ?? 2.4),
  /** BRouter (#1340): `brouter` service of the docker-compose file, never exposed. */
  brouterUrl: process.env.BROUTER_URL ?? 'http://brouter:17777',
  /** "Source code" link (AGPL §13, #1472): public repository by default, to override for a modified version. */
  sourceUrl: process.env.SOURCE_URL || 'https://github.com/Clement83/singletrack',
  /** Semver version of the application (#1485), injected at build time from package.json (next.config.mjs). */
  version: process.env.APP_VERSION || 'dev',
  /** Sources actives (#1473). */
  dataSources: parseDataSources(process.env.DATA_SOURCES),
  /** Departments synced by default by the `sync:*` scripts; empty = all of France. */
  syncZones: parseSyncZones(process.env.SYNC_ZONES),
};

export function sourceEnabled(name: DataSource): boolean {
  return config.dataSources.has(name);
}
