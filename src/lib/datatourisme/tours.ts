import type { Position, TrackGeometry } from '@/lib/geo';
import { geometryLength } from '@/lib/geo';
import type { GpxFile } from '@/lib/geo/gpx';
import type { Difficulty, NormalizedTrack } from '@/lib/tracks';

/** Mountain-bike practices (`hasPracticeCondition.hasLocomotionMode`, thesaurus LocomotionMode). */
export const MTB_MODES = ['MBMode', 'EAMBMode', 'EnduroMode', 'DownhillbikeMode', 'FatbikeMode'] as const;
/** Some producers (e.g. the Var) only tag the theme: `ATV` = "VTT", `ElectricATV` = "VTT électrique". */
export const MTB_THEMES = ['ATV', 'ElectricATV'] as const;

/** DATAtourisme data is published under the Etalab Open Licence 2.0; the producer is credited on each track. */
export const DATATOURISME_LICENSE = 'Licence Ouverte v2.0 (Etalab)';

/** Fields requested on the list: everything the import needs, nothing more (smaller pages, fewer bytes). */
export const LIST_FIELDS = [
  'uuid',
  'uri',
  'label',
  'hasDescription',
  'hasPracticeCondition',
  'hasTheme',
  'hasRepresentation',
  'hasBeenCreatedBy.legalName',
  'hasBeenCreatedBy.homepage',
  'hasContact.homepage',
  'isLocatedAt.geo',
  'lastUpdate',
  'tourDistance',
].join(',');

export const PAGE_SIZE = 100;

type Lang = { '@fr'?: string; '@en'?: string } | undefined;
type Keyed = { key?: string; label?: Lang };

export type DtTour = {
  uuid: string;
  uri?: string;
  label?: Lang;
  hasDescription?: { shortDescription?: Lang; description?: Lang }[];
  hasPracticeCondition?: { hasLocomotionMode?: Keyed[]; hasDifficultyLevel?: Keyed[] }[];
  hasTheme?: Keyed[];
  hasRepresentation?: { hasRelatedResource?: { locator?: string[]; hasMimeType?: Keyed[] }[] }[];
  hasBeenCreatedBy?: { legalName?: string; homepage?: string[] };
  hasContact?: { homepage?: string[] }[];
  isLocatedAt?: { geo?: { latitude?: number; longitude?: number } }[];
  lastUpdate?: string;
  tourDistance?: number;
};

export type DtPage = { objects: DtTour[]; meta: { total: number; next: string | null } };

const text = (l: Lang) => l?.['@fr']?.trim() || l?.['@en']?.trim() || null;

/**
 * First page URL. `zones` = department INSEE codes (empty = all of France); `since` = only tours updated by
 * their producer on or after that day (`lastUpdate`, incremental runs). `lastUpdateDatatourisme` is useless for
 * that: the platform re-indexes every record regularly.
 */
export function firstPageUrl(zones: string[], since: string | null): string {
  const parts = [`(hasPracticeCondition.hasLocomotionMode.key[in]=${MTB_MODES.join(',')} OR hasTheme.key[in]=${MTB_THEMES.join(',')})`];
  if (zones.length) parts.push(`isLocatedAt.address.hasAddressCity.isPartOfDepartment.insee[in]=${zones.join(',')}`);
  if (since) parts.push(`lastUpdate[gte]=${since}`);
  const q = new URLSearchParams({ page_size: String(PAGE_SIZE), lang: 'fr', fields: LIST_FIELDS, sort: 'uuid', filters: parts.join(' AND ') });
  return `/tour?${q}`;
}

export type TraceFile = { url: string; kind: 'gpx' | 'kml' | 'kmz' };

/** Best attached trace file: GPX first, then KML, then KMZ (`hasRepresentation` → MIME type + locator). */
export function pickTraceFile(t: DtTour): TraceFile | null {
  const found: TraceFile[] = [];
  for (const rep of t.hasRepresentation ?? []) {
    for (const res of rep.hasRelatedResource ?? []) {
      const url = res.locator?.find((u) => /^https?:\/\//i.test(u));
      if (!url) continue;
      const mimes = (res.hasMimeType ?? []).map((m) => `${m.key ?? ''} ${text(m.label) ?? ''}`.toLowerCase());
      const kind = mimes.some((m) => m.includes('gpx')) || /\.gpx(\?|$)/i.test(url)
        ? 'gpx'
        : mimes.some((m) => m.includes('kmz')) || /\.kmz(\?|$)/i.test(url)
          ? 'kmz'
          : mimes.some((m) => m.includes('kml')) || /\.kml(\?|$)/i.test(url)
            ? 'kml'
            : null;
      if (kind) found.push({ url, kind });
    }
  }
  const rank = { gpx: 0, kml: 1, kmz: 2 } as const;
  return found.sort((a, b) => rank[a.kind] - rank[b.kind])[0] ?? null;
}

const DIFFICULTY: Record<string, Difficulty> = {
  VeryEasyTour: 'green',
  EasyTour: 'green',
  MediumDifficultyTour: 'blue',
  DifficultTour: 'red',
  VeryDifficultTour: 'black',
};

export function tourDifficulty(t: DtTour): { difficulty: Difficulty | null; raw: string | null } {
  const key = t.hasPracticeCondition?.flatMap((p) => p.hasDifficultyLevel ?? []).find((d) => d.key)?.key ?? null;
  return { difficulty: (key && DIFFICULTY[key]) || null, raw: key };
}

/** Minimum length of an imported trace: below that, the file is a marker or a broken export. */
export const MIN_LENGTH_M = 500;

/** Geometry of a parsed GPX/KML file: every line with at least 2 points, as one (Multi)LineString. */
export function fileGeometry(file: GpxFile): TrackGeometry | null {
  const lines: Position[][] = [];
  for (const tr of file.tracks) {
    const g = tr.geometry;
    if (g.type === 'LineString') lines.push(g.coordinates);
    else lines.push(...g.coordinates);
  }
  const ok = lines.filter((l) => l.length >= 2);
  if (!ok.length) return null;
  const geometry: TrackGeometry = ok.length === 1 ? { type: 'LineString', coordinates: ok[0] } : { type: 'MultiLineString', coordinates: ok };
  return geometryLength(geometry) >= MIN_LENGTH_M ? geometry : null;
}

/** DATAtourisme tour + its trace → track of the `datatourisme` source (always public, see `SYNCED_SOURCES`). */
export function tourToTrack(t: DtTour, geometry: TrackGeometry, file: TraceFile): NormalizedTrack {
  const creator = t.hasBeenCreatedBy?.legalName?.trim() || null;
  const { difficulty, raw } = tourDifficulty(t);
  const desc = t.hasDescription?.map((d) => text(d.description) ?? text(d.shortDescription)).find(Boolean) ?? null;
  const homepage = t.hasContact?.flatMap((c) => c.homepage ?? []).find((u) => /^https?:\/\//i.test(u))
    ?? t.hasBeenCreatedBy?.homepage?.find((u) => /^https?:\/\//i.test(u))
    ?? null;
  return {
    source: 'datatourisme',
    externalId: t.uuid,
    sourceUrl: homepage,
    name: text(t.label) ?? 'Circuit VTT',
    description: desc,
    author: creator,
    license: DATATOURISME_LICENSE,
    attribution: creator ? `Source : ${creator}, via DATAtourisme` : 'Source : DATAtourisme',
    geometry,
    difficulty,
    difficultyRaw: raw,
    sourceUpdatedAt: t.lastUpdate ? new Date(`${t.lastUpdate}T00:00:00Z`) : null,
    raw: { uuid: t.uuid, uri: t.uri ?? null, file: file.url, kind: file.kind },
  };
}
