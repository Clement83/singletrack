import { federationEnabled } from '@/lib/federation/config';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/db';
import { requireUser } from '@/lib/current-user';
import { getVisibleTrack } from '@/lib/tracks';
import { getDefaultOutingVisibility } from '@/lib/user-profile';
import { OutingForm } from '@/components/outings/outing-form';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('newOuting'), robots: { index: false, follow: false } };
}

// Création d'une sortie depuis une fiche trace : /sorties/nouvelle?trace=<slug>
export default async function Page({ searchParams }: { searchParams: Promise<{ trace?: string }> }) {
  const user = await requireUser();
  const slug = (await searchParams).trace;
  const t = slug ? getVisibleTrack(getDb().db, slug, user.id) : undefined; // règle d'accès unique (#1589)
  if (!t || t.status === 'draft') notFound(); // invisible ⇒ 404 (jamais 403)
  const tr = await getTranslations('outings');
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 pt-4">
      <Link href={`/t/${t.slug}`} className="flex min-h-touch items-center gap-2 text-body font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">
        <ArrowLeft aria-hidden className="size-5" /> {t.name}
      </Link>
      <h1 className="text-title">{tr('newTitle')}</h1>
      <OutingForm
        federated={federationEnabled()}
        trackVisibility={t.visibility}
        mode={{ kind: 'create', trackSlug: t.slug }}
        initial={{ title: t.name, description: '', date: '', time: '09:00', meetingLat: t.startLat, meetingLon: t.startLon, meetingLabel: '', level: 'sportif', ebike: 'yes', maxParticipants: '', visibility: getDefaultOutingVisibility(getDb().db, user.id), participantsCanInvite: false }}
      />
    </main>
  );
}
