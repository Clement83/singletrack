import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { track } from '@/db/schema';
import { massifsForGeometry } from '@/lib/fire';
import { enrichElevation, geometryStats, type EnrichOptions } from '@/lib/geo';
import type { NormalizedTrack, RegionConfig, TrackSource } from './types';

export type UpsertResult = { id: string; slug: string; created: boolean };

export type UpsertOptions = {
  /** Altitude IGN à l'enregistrement (défaut : oui, remplace l'altitude source #1515) ; `false` pour les sources en masse. */
  enrich?: boolean | EnrichOptions;
  now?: Date;
};

/** Colonnes dérivées de la géométrie (bbox, départ, distance, D+/D-, boucle). */
export async function deriveColumns(t: NormalizedTrack, opts: UpsertOptions = {}) {
  let geometry = t.geometry;
  if (opts.enrich !== false) {
    geometry = await enrichElevation(geometry, { replace: true, ...(typeof opts.enrich === 'object' ? opts.enrich : {}) });
  }
  const s = geometryStats(geometry);
  if (!s.bbox || !s.start) throw new Error(`Trace « ${t.name} » sans géométrie`);
  return {
    geometry,
    bboxMinLon: s.bbox.minLon,
    bboxMinLat: s.bbox.minLat,
    bboxMaxLon: s.bbox.maxLon,
    bboxMaxLat: s.bbox.maxLat,
    startLon: s.start[0],
    startLat: s.start[1],
    distanceM: s.distanceM,
    elevationGainM: s.gainM,
    elevationLossM: s.lossM,
    minEle: s.minEle,
    maxEle: s.maxEle,
    loop: s.loop,
  };
}

/**
 * Insère ou met à jour une trace sur `(source, external_id)`. Réimporter ne crée jamais de doublon
 * et conserve `id`, `slug` et `created_at` (les liens `/t/<slug>` restent valides).
 * Sans `externalId` (trace maison), on insère toujours.
 */
export async function upsertTrack(db: Db, t: NormalizedTrack, opts: UpsertOptions = {}): Promise<UpsertResult> {
  const now = opts.now ?? new Date();
  const derived = await deriveColumns(t, opts);
  const values = {
    source: t.source,
    externalId: t.externalId,
    sourceUrl: t.sourceUrl ?? null,
    name: t.name,
    description: t.description ?? null,
    author: t.author ?? null,
    license: t.license ?? null,
    attribution: t.attribution ?? null,
    difficulty: t.difficulty ?? null,
    difficultyRaw: t.difficultyRaw ?? null,
    sourceUpdatedAt: t.sourceUpdatedAt ?? null,
    ...(t.createdBy !== undefined ? { createdBy: t.createdBy } : {}),
    ...(t.parentTrackId !== undefined ? { parentTrackId: t.parentTrackId } : {}),
    ...(t.status ? { status: t.status } : {}),
    raw: t.raw ?? null,
    importedAt: now,
    updatedAt: now,
    ...derived,
    massifs: massifsForGeometry(db, derived.geometry),
  };

  const existing =
    t.externalId == null
      ? undefined
      : db
          .select({ id: track.id, slug: track.slug })
          .from(track)
          .where(and(eq(track.source, t.source), eq(track.externalId, t.externalId)))
          .get();

  if (existing) {
    db.update(track).set(values).where(eq(track.id, existing.id)).run();
    return { ...existing, created: false };
  }
  const row = db.insert(track).values({ ...values, createdAt: now }).returning({ id: track.id, slug: track.slug }).get();
  return { ...row, created: true };
}

export type SyncReport = { created: number; updated: number; failed: number };

/** Consomme une source et upsert chaque trace ; une trace en erreur n'arrête pas l'import. */
export async function syncSource(
  db: Db,
  source: TrackSource,
  region: RegionConfig,
  opts: UpsertOptions = {},
  onError: (e: unknown, t: NormalizedTrack) => void = () => {},
): Promise<SyncReport> {
  const report: SyncReport = { created: 0, updated: 0, failed: 0 };
  for await (const t of source.sync(region)) {
    try {
      const r = await upsertTrack(db, t, opts);
      if (r.created) report.created++;
      else report.updated++;
    } catch (e) {
      report.failed++;
      onError(e, t);
    }
  }
  return report;
}
