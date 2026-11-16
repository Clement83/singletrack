import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TrackEditor } from '@/components/editor/track-editor';
import { emptyDoc } from '@/lib/editor/doc';
import { config } from '@/lib/config';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('newTrack'), robots: { index: false, follow: false } };
}

/** Éditeur sur une carte vierge centrée sur la maison (#1340). */
export default function NewTrackPage() {
  return <TrackEditor mode="create" initialDoc={emptyDoc()} home={[config.homeLon, config.homeLat]} />;
}
