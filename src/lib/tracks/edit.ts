import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { track, type TrackRow } from '@/db/schema';
import { geometryStats, type Position, type TrackGeometry } from '@/lib/geo';
import { massifsForGeometry } from '@/lib/fire';
import { parseStored, type StoredDoc } from '@/lib/editor/doc';
import type { NormalizedTrack } from './types';
import { getDefaultTrackVisibility, isTrackVisibility } from '@/lib/user-profile';
import { SYNCED_SOURCES, deriveColumns, upsertTrack, type UpsertOptions } from './upsert';
import { getTrackBySlug } from './query';

/** Ce que l'éditeur envoie à l'enregistrement. */
export type EditorInput = {
  name: string;
  description?: string | null;
  geometry: TrackGeometry;
  waypoints: unknown;
  modes: unknown;
  /** Slug de la trace d'origine : on enregistre alors une copie modifiée. */
  parentSlug?: string | null;
  /** `draft` (#1450) : enregistrement automatique, nom et longueur minimale non exigés. Absent = publiée. */
  status?: 'draft' | 'published';
  /** #1588 : absent = préférence du compte (création) ou inchangé (mise à jour). */
  visibility?: string;
};

export type EditorErrors = Partial<Record<'name' | 'geometry' | 'waypoints' | 'parent', string>>;

export const MAX_EDITOR_POINTS = 50_000;
/** Sources dont l'auteur peut modifier la trace en place (jamais une trace OSM / Geotrek / Utagawa). */
export const EDITABLE_SOURCES = ['manual', 'edited', 'gpx'] as const;

const clean = (s: string | null | undefined) => s?.trim() || null;
const validPos = (p: unknown): p is Position =>
  Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** Valide l'entrée de l'éditeur ; renvoie la géométrie nettoyée et le document d'édition à conserver. */
export function validateEditorInput(i: EditorInput, draft = i?.status === 'draft'): { name: string; description: string | null; geometry: TrackGeometry; stored: StoredDoc } | { errors: EditorErrors } {
  const errors: EditorErrors = {};
  const name = clean(i?.name);
  if (!name) {
    if (!draft) errors.name = 'nameRequired';
  } else if (name.length > 200) errors.name = 'nameTooLong';
  const g = i?.geometry;
  const coords = g?.type === 'LineString' && Array.isArray(g.coordinates) ? g.coordinates : null;
  if (!coords || coords.length < 2 || coords.length > MAX_EDITOR_POINTS || !coords.every(validPos)) {
    errors.geometry = 'geometryInvalid';
  }
  const stored = parseStored({ waypoints: i?.waypoints, modes: i?.modes });
  if (!stored) errors.waypoints = 'waypointsInvalid';
  let geometry: TrackGeometry | null = null;
  if (coords && !errors.geometry) {
    geometry = {
      type: 'LineString',
      coordinates: coords.map((p) => (Number.isFinite(p[2]) ? ([p[0], p[1], p[2]] as Position) : ([p[0], p[1]] as Position))),
    };
    if (!draft && geometryStats(geometry).distanceM < 100) errors.geometry = 'geometryTooShort';
  }
  if (Object.keys(errors).length || !geometry || !stored || (!name && !draft)) return { errors };
  return { name: name ?? '', description: clean(i.description), geometry, stored };
}

/** L'utilisateur peut-il modifier cette trace en place ? Sinon : copie. */
export function canEditInPlace(t: Pick<TrackRow, 'source' | 'createdBy'>, userId: string): boolean {
  return t.createdBy === userId && (EDITABLE_SOURCES as readonly string[]).includes(t.source);
}

/** Document d'édition conservé dans `raw.editor` (waypoints + mode de chaque segment). */
export function storedFromRaw(raw: unknown): StoredDoc | null {
  return parseStored((raw as { editor?: unknown } | null)?.editor);
}

export type SaveResult = { slug: string } | { errors: EditorErrors } | { error: 'not_found' | 'forbidden' };

/**
 * Crée une trace : maison (`source = manual`) ou copie modifiée d'une autre (`source = edited`,
 * `parent_track_id`, attribution de l'origine conservée — l'original n'est jamais touché).
 */
export async function createEditedTrack(db: Db, userId: string, input: EditorInput, opts: UpsertOptions = {}): Promise<SaveResult> {
  const draft = input?.status === 'draft';
  const v = validateEditorInput(input, draft);
  if ('errors' in v) return v;
  const parent = input.parentSlug ? getTrackBySlug(db, input.parentSlug) : undefined;
  if (input.parentSlug && !parent) return { errors: { parent: 'parentGone' } };
  const t: NormalizedTrack = {
    source: parent ? 'edited' : 'manual',
    externalId: null,
    name: v.name,
    description: v.description,
    geometry: v.geometry,
    createdBy: userId,
    parentTrackId: parent?.id ?? null,
    status: draft ? 'draft' : 'published',
    visibility: isTrackVisibility(input?.visibility) ? input.visibility : getDefaultTrackVisibility(db, userId, 'drawn'),
    ...(parent
      ? {
          sourceUrl: parent.sourceUrl,
          author: parent.author,
          license: parent.license,
          attribution: parent.attribution ?? (parent.createdBy === userId ? null : `Adapté de « ${parent.name} »`),
          difficulty: parent.difficulty,
          difficultyRaw: parent.difficultyRaw,
        }
      : {}),
    raw: { editor: v.stored, ...(parent ? { parent: { slug: parent.slug, source: parent.source } } : {}) },
  };
  const res = await upsertTrack(db, t, opts);
  return { slug: res.slug };
}

/** Met à jour en place une trace de l'utilisateur (maison, copie ou GPX importé). Le slug ne change pas. */
export async function updateEditedTrack(db: Db, userId: string, slug: string, input: EditorInput, opts: UpsertOptions = {}): Promise<SaveResult> {
  const existing = getTrackBySlug(db, slug);
  if (!existing) return { error: 'not_found' };
  if (!canEditInPlace(existing, userId)) return { error: 'forbidden' };
  // Une trace publiée ne redevient jamais brouillon ; un brouillon est publié par `status: 'published'` (nom exigé).
  const status: 'draft' | 'published' = existing.status === 'published' || input?.status === 'published' ? 'published' : 'draft';
  const v = validateEditorInput(input, status === 'draft');
  if ('errors' in v) return v;
  const derived = await deriveColumns(
    { source: existing.source, externalId: existing.externalId, name: v.name, geometry: v.geometry },
    opts,
  );
  const prevRaw = existing.raw && typeof existing.raw === 'object' ? (existing.raw as Record<string, unknown>) : {};
  db.update(track)
    .set({
      name: v.name,
      description: v.description,
      ...derived,
      massifs: massifsForGeometry(db, derived.geometry),
      status,
      ...(isTrackVisibility(input?.visibility) && !SYNCED_SOURCES.includes(existing.source) ? { visibility: input.visibility } : {}),
      raw: { ...prevRaw, editor: v.stored },
      updatedAt: opts.now ?? new Date(),
    })
    .where(eq(track.id, existing.id))
    .run();
  return { slug };
}
