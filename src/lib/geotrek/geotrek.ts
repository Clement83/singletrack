import type { TrackGeometry, Position } from '@/lib/geo';
import { difficultyFromLabel, type NormalizedTrack, type RegionConfig, type TrackSource } from '@/lib/tracks';

/** Une instance Geotrek-admin (API v2, publique, sans clé) et les pratiques à importer. */
export type GeotrekInstance = {
  /** Identifiant stable, préfixe de `external_id` (ex. `var`). */
  id: string;
  /** Base de l'API, sans slash final : `https://gestion-sportnature.var.fr/api/v2`. */
  apiBase: string;
  /** Pratiques à importer (`trek_practice`), ex. `[2]` = Randonnée VTT. */
  practices: number[];
  /** Fiche publique d'un itinéraire. */
  ficheUrl: (t: GeotrekTrek) => string;
  attribution: string;
  license?: string | null;
  author?: string | null;
};

export const SPORT_NATURE_VAR: GeotrekInstance = {
  id: 'var',
  apiBase: 'https://gestion-sportnature.var.fr/api/v2',
  practices: [2],
  ficheUrl: (t) => `https://sportnature.var.fr/trek/${t.id}-${slugify(t.name)}`,
  attribution: 'Source : Département du Var – Sport Nature Var',
  // L'API ne déclare aucune licence : on ne l'invente pas, l'attribution suffit à citer la source.
  license: null,
  author: 'Département du Var',
};

export type GeotrekTrek = {
  id: number;
  name: string;
  description_teaser?: string | null;
  description?: string | null;
  difficulty?: number | null;
  geometry?: { type: string; coordinates: unknown } | null;
  published?: boolean;
  update_datetime?: string | null;
  uuid?: string;
  departure?: string | null;
  duration?: number | null;
  length_2d?: number | null;
  ascent?: number | null;
  practice?: number | null;
  gpx?: string | null;
  pdf?: string | null;
};

type Page<T> = { results?: T[]; next?: string | null };

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** HTML de Geotrek (`<p>`, entités) → texte brut. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à').replace(/&ecirc;/g, 'ê').replace(/&ocirc;/g, 'ô').replace(/&ccedil;/g, 'ç')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return text || null;
}

function toGeometry(g: GeotrekTrek['geometry']): TrackGeometry | null {
  if (!g) return null;
  if (g.type === 'LineString') {
    const c = g.coordinates as Position[];
    return c.length >= 2 ? { type: 'LineString', coordinates: c } : null;
  }
  if (g.type === 'MultiLineString') {
    const c = (g.coordinates as Position[][]).filter((l) => l.length >= 2);
    return c.length === 0 ? null : c.length === 1 ? { type: 'LineString', coordinates: c[0] } : { type: 'MultiLineString', coordinates: c };
  }
  return null;
}

/** Un itinéraire Geotrek → trace normalisée. `difficultyLabels` : id → libellé (référentiel `trek_difficulty`). */
export function trekToTrack(inst: GeotrekInstance, t: GeotrekTrek, difficultyLabels: Map<number, string>): NormalizedTrack | null {
  if (t.published === false) return null;
  const geometry = toGeometry(t.geometry);
  if (!geometry) return null;
  const label = t.difficulty != null ? difficultyLabels.get(t.difficulty) ?? null : null;
  return {
    source: 'geotrek',
    externalId: `${inst.id}/${t.id}`,
    sourceUrl: inst.ficheUrl(t),
    name: t.name.trim(),
    description: htmlToText(t.description_teaser) ?? htmlToText(t.description),
    author: inst.author ?? null,
    license: inst.license ?? null,
    attribution: inst.attribution,
    geometry,
    difficulty: difficultyFromLabel(label),
    difficultyRaw: label ? `${label} (${t.difficulty})` : null,
    sourceUpdatedAt: t.update_datetime ? new Date(t.update_datetime) : null,
    raw: { id: t.id, uuid: t.uuid, practice: t.practice, official: true, departure: t.departure, duration: t.duration, gpx: t.gpx, pdf: t.pdf, lengthM: t.length_2d, ascentM: t.ascent },
  };
}

export type GeotrekSourceOptions = { instance?: GeotrekInstance; fetchImpl?: typeof fetch; timeoutMs?: number };

/** Source Geotrek générique : pagination `next`, référentiel de difficultés, un appel de liste par pratique. */
export function geotrekSource(opts: GeotrekSourceOptions = {}): TrackSource {
  const inst = opts.instance ?? SPORT_NATURE_VAR;
  const doFetch = opts.fetchImpl ?? fetch;
  const getJson = async <T>(url: string): Promise<T> => {
    const res = await doFetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'singletrack-sync/1.0' }, signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) });
    if (!res.ok) throw new Error(`Geotrek HTTP ${res.status} (${url})`);
    return (await res.json()) as T;
  };
  async function* pages<T>(first: string): AsyncGenerator<T> {
    let next: string | null | undefined = first;
    while (next) {
      const p: Page<T> = await getJson<Page<T>>(next);
      for (const r of p.results ?? []) yield r;
      next = p.next;
    }
  }
  return {
    id: 'geotrek',
    async *sync(_region: RegionConfig) {
      const labels = new Map<number, string>();
      for await (const d of pages<{ id: number; label: string }>(`${inst.apiBase}/trek_difficulty/?language=fr`)) labels.set(d.id, d.label);
      for (const p of inst.practices) {
        for await (const t of pages<GeotrekTrek>(`${inst.apiBase}/trek/?practices=${p}&language=fr&page_size=50`)) {
          const n = trekToTrack(inst, t, labels);
          if (n) yield n;
        }
      }
    },
  };
}
