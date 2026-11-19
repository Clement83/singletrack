import { federationEnabled } from '@/lib/federation/config';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/db';
import { track } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { OutingForm } from '@/components/outings/outing-form';
import { requireUser } from '@/lib/current-user';
import { getOwnedOuting, utcToParisInputs } from '@/lib/outings';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('editOuting'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  const slug = (await params).slug;
  const o = getOwnedOuting(getDb().db, user.id, slug);
  if (!o) notFound();
  const tk = o.trackId ? getDb().db.select().from(track).where(eq(track.id, o.trackId)).get() : undefined;
  const { date, time } = utcToParisInputs(o.startsAt);
  const tr = await getTranslations('outings');
  const tp = await getTranslations('outingPage');
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 pt-4">
      <Link href={`/s/${o.slug}`} className="flex min-h-touch items-center gap-2 text-body font-medium text-primary underline-offset-4 hover:underline active:opacity-70">
        <ArrowLeft aria-hidden className="size-5" /> {tp('backToOuting')}
      </Link>
      <h1 className="text-title">{tr('editTitle')}</h1>
      <OutingForm
        federated={federationEnabled()}
        trackVisibility={tk?.visibility ?? null}
        mode={{ kind: 'edit', outingSlug: o.slug }}
        initial={{ title: o.title, description: o.description ?? '', date, time, meetingLat: o.meetingLat, meetingLon: o.meetingLon, meetingLabel: o.meetingLabel ?? '', level: o.level, ebike: o.ebike, maxParticipants: o.maxParticipants?.toString() ?? '', visibility: o.visibility, participantsCanInvite: o.participantsCanInvite }}
      />
    </main>
  );
}
