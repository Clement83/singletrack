import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { track, type TrackRow } from '@/db/schema';
import { geometryStats, type Position, type TrackGeometry } from '@/lib/geo';
import { massifsForGeometry } from '@/lib/fire';
import { parseStored, type StoredDoc } from '@/lib/editor/doc';
import type { NormalizedTrack } from './types';
import { getDefaultTrackVisibility, isTrackVisibility } from '@/lib/user-profile';
import { SYNCED_SOURCES, deriveColumns, upsertTrack, type UpsertOptions } from './upsert';
import { getTrackBySlug, getVisibleTrack } from './query';

/** What the editor sends on save. */
export type EditorInput = {
  name: string;
  description?: string | null;
  geometry: TrackGeometry;
  waypoints: unknown;
  modes: unknown;
  /** Slug of the original track: a modified copy is saved instead. */
  parentSlug?: string | null;
  /** `draft` (#1450): automatic save, name and minimum length not required. Absent = published. */
  status?: 'draft' | 'published';
  /** #1588: absent = account preference (creation) or unchanged (update). */
  visibility?: string | null;
};

export type EditorErrors = Partial<Record<'name' | 'geometry' | 'waypoints' | 'parent' | 'visibility', string>>;

export const MAX_EDITOR_POINTS = 50_000;
/** Sources whose author may edit the track in place (never an OSM / Geotrek / Utagawa track). */
export const EDITABLE_SOURCES = ['manual', 'edited', 'gpx'] as const;

const clean = (s: string | null | undefined) => s?.trim() || null;
const validPos = (p: unknown): p is Position =>
  Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** Validates the editor's input; returns the cleaned geometry and the editing document to keep. */
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
  // #1590: absent = account default / unchanged; present but unknown = 422.
  if (i?.visibility !== undefined && i.visibility !== null && !isTrackVisibility(i.visibility)) errors.visibility = 'visibilityInvalid';
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

/** Can the user edit this track in place? Otherwise: copy. */
export function canEditInPlace(t: Pick<TrackRow, 'source' | 'createdBy'>, userId: string): boolean {
  return t.createdBy === userId && (EDITABLE_SOURCES as readonly string[]).includes(t.source);
}

/** Editing document kept in `raw.editor` (waypoints + mode of each segment). */
export function storedFromRaw(raw: unknown): StoredDoc | null {
  return parseStored((raw as { editor?: unknown } | null)?.editor);
}

/**
 * Changes the visibility of a track of the user (#1590). 404 if unknown or invisible to them, 403 if it is not
 * theirs or if it comes from a synced source (always public), 422 `invalid` for an unknown value.
 */
export function setTrackVisibility(db: Db, userId: string, slug: string, value: unknown): { ok: true; visibility: string } | { error: 'not_found' | 'forbidden' | 'invalid' } {
  const existing = getVisibleTrack(db, slug, userId);
  if (!existing) return { error: 'not_found' };
  if (!canEditInPlace(existing, userId) || SYNCED_SOURCES.includes(existing.source)) return { error: 'forbidden' };
  if (!isTrackVisibility(value)) return { error: 'invalid' };
  db.update(track).set({ visibility: value, updatedAt: new Date() }).where(eq(track.id, existing.id)).run();
  return { ok: true, visibility: value };
}

export type SaveResult = { slug: string } | { errors: EditorErrors } | { error: 'not_found' | 'forbidden' };

/**
 * Creates a track: home-made (`source = manual`) or modified copy of another one (`source = edited`,
 * `parent_track_id`, attribution of the original kept — the original is never touched).
 */
export async function createEditedTrack(db: Db, userId: string, input: EditorInput, opts: UpsertOptions = {}): Promise<SaveResult> {
  const draft = input?.status === 'draft';
  const v = validateEditorInput(input, draft);
  if ('errors' in v) return v;
  // Copy (#1589): the original track must be visible to the copy's author; otherwise same answer as "gone".
  const parent = input.parentSlug ? getVisibleTrack(db, input.parentSlug, userId) : undefined;
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

/** Updates a track of the user in place (home-made, copy or imported GPX). The slug does not change. */
export async function updateEditedTrack(db: Db, userId: string, slug: string, input: EditorInput, opts: UpsertOptions = {}): Promise<SaveResult> {
  const existing = getTrackBySlug(db, slug);
  if (!existing) return { error: 'not_found' };
  if (!canEditInPlace(existing, userId)) return { error: 'forbidden' };
  // A published track never becomes a draft again; a draft is published with `status: 'published'` (name required).
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
