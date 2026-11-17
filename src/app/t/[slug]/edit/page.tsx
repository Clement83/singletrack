import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { TrackEditor, type EditorMode } from '@/components/editor/track-editor';
import { config } from '@/lib/config';
import { docFromGeometry, docFromStoredWithGeometry } from '@/lib/editor/doc';
import { requireUser } from '@/lib/current-user';
import { canEditInPlace, ensureTrackElevation, getTrackBySlug, canViewTrack, storedFromRaw } from '@/lib/tracks';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('editor'), robots: { index: false, follow: false } };
}

/**
 * Éditeur d'une trace existante (#1340). `/t` est une base publique (liens invités) : cette page est
 * privée par `requireUser()`, pas par le proxy. Trace de l'utilisateur → modifiée en place ; trace
 * d'un autre ou importée (OSM, Geotrek...) ou `?copie=1` → on édite une copie, l'original reste intact.
 */
export default async function EditTrackPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ copie?: string }> }) {
  const user = await requireUser();
  const { slug } = await params;
  const found = getTrackBySlug(getDb().db, slug);
  if (!found || !canViewTrack(getDb().db, found, user.id)) notFound(); // brouillon d'un autre : 404 (#1450)
  const t = await ensureTrackElevation(getDb().db, found); // altitude IGN à la première ouverture (#1428)
  const draft = t.status === 'draft';
  const wantCopy = (await searchParams).copie === '1' && !draft;
  const mode: EditorMode = !wantCopy && canEditInPlace(t, user.id) ? 'update' : 'copy';
  const stored = storedFromRaw(t.raw);
  const doc = stored ? docFromStoredWithGeometry(stored, t.geometry) : docFromGeometry(t.geometry);
  return (
    <TrackEditor
      mode={mode}
      initialDoc={doc}
      initialName={mode === 'copy' ? `${t.name} (copie)` : t.name}
      initialDescription={t.description ?? ''}
      slug={t.slug}
      initialStatus={t.status}
      home={[config.homeLon, config.homeLat]}
      bounds={[t.bboxMinLon, t.bboxMinLat, t.bboxMaxLon, t.bboxMaxLat]}
    />
  );
}
