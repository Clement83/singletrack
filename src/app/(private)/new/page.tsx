import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TrackEditor } from '@/components/editor/track-editor';
import { emptyDoc } from '@/lib/editor/doc';
import { parseMapView } from '@/lib/tracks/map-view';
import { getDb } from '@/db';
import { requireUser } from '@/lib/current-user';
import { getDefaultTrackVisibility } from '@/lib/user-profile';
import { config } from '@/lib/config';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('newTrack'), robots: { index: false, follow: false } };
}

/** Éditeur sur une carte vierge centrée sur la maison (#1340). */
export default async function NewTrackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Vue de la carte transmise par l'explorateur (#1577) : l'éditeur s'ouvre au même endroit.
  const raw = await searchParams;
  const sp = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])));
  const v = parseMapView(sp);
  const user = await requireUser();
  return <TrackEditor mode="create" initialDoc={emptyDoc()} initialVisibility={getDefaultTrackVisibility(getDb().db, user.id, 'drawn')} home={v ? [v.lng, v.lat] : [config.homeLon, config.homeLat]} initialZoom={v?.z} />;
}
