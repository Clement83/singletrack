import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { AppNav } from '@/components/app-nav';
import { Badge } from '@/components/ui/badge';
import { OutingView } from '@/components/outings/outing-view';
import { RemoteAnswer } from '@/components/outings/remote-answer';
import { RemoteModeration } from '@/components/federation/remote-moderation';
import { requireUser } from '@/lib/current-user';
import { RideSection } from '@/components/outings/ride-section';
import { OutingSummary } from '@/components/outings/outing-summary/outing-summary';
import { listRemoteOutings } from '@/lib/federation/outings';
import { joinedRemoteOuting, listMyRemoteRide } from '@/lib/federation/rides';
import { canUploadRide } from '@/lib/outings/ride';
import { isDone } from '@/lib/outings/history';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('outings'), robots: { index: false, follow: false } };
}

// Outing from another server (#1476): cached copy, the organiser remains the reference. Weather, map and track will come from the copy.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { db } = getDb();
  const o = listRemoteOutings(db, user.id, { id: (await params).id })[0];
  if (!o) notFound();
  const t = await getTranslations('remoteOutings');
  const answerable = o.status === 'planned' && !o.closed;
  const stateText = o.state === 'none' ? null
    : o.state === 'rejected' ? t(`state.rejected.${o.reason === 'full' || o.reason === 'closed' || o.reason === 'forbidden' ? o.reason : 'other'}`, { domain: o.organizer.domain })
    : t(`state.${o.state}`, { domain: o.organizer.domain });
  // Never a slug (already emptied on reception); absent ⇒ route block hidden.
  const track = o.track && o.track.geometry ? o.track : null;
  // My ridden track (#1779): kept here, sent to the organiser's server when it can receive it; personal summary built from it.
  const joined = !!joinedRemoteOuting(db, user.id, o.id);
  const rides = joined ? listMyRemoteRide(db, user.id, o.id) : [];
  const canRide = joined && canUploadRide(o);
  const base = `/api/remote-outings/${o.id}`;
  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        <OutingView
          role="visitor"
          presentation="page"
          outing={{ title: o.title, startsAt: o.startsAt, level: o.level, ebike: o.ebike, meetingLabel: o.label, meetingLat: o.lat, meetingLon: o.lon, description: o.description, cancelled: o.status === 'cancelled' }}
          track={track}
          topLink={
            <Link href="/sorties" className="flex min-h-touch items-center gap-2 text-body font-medium text-primary underline-offset-4 hover:underline active:opacity-70">
              <ArrowLeft aria-hidden className="size-5" /> {t('back')}
            </Link>
          }
          notices={
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{t('badge', { domain: o.organizer.domain })}</Badge>
                {o.invited && <Badge variant="primary">{t('invited')}</Badge>}
                <Badge variant="outline">{t('going', { n: o.yesCount })}</Badge>
                {o.spotsLeft != null && <Badge variant={o.spotsLeft === 0 ? 'danger' : 'outline'}>{t('spots', { n: o.spotsLeft })}</Badge>}
              </div>
              <p className="text-small text-muted-foreground">
                <a href={o.organizer.profileUrl} rel="noopener noreferrer nofollow" className="underline underline-offset-4">{t('by', { name: o.organizer.name, domain: o.organizer.domain })}</a>
              </p>
            </>
          }
          primaryAction={
            <>
              {o.status === 'cancelled' ? <p className="rounded-2xl border border-border bg-accent/40 p-3 text-body">{t('cancelled')}</p>
                : answerable ? <RemoteAnswer id={o.id} current={o.answer} domain={o.organizer.domain} />
                : <p className="text-muted-foreground">{t('closed')}</p>}
              {o.answer !== 'pending' && <p className="text-small">{t('yourAnswer', { answer: t(`answers.${o.answer}`) })}{stateText ? ` — ${stateText}` : ''}</p>}
            </>
          }
          summary={rides.length > 0 && isDone(o, new Date()) && o.status !== 'cancelled' ? (
            <OutingSummary recapUrl={`${base}/recap`} photoBase={`${base}/photos`} videoBase={`${base}/videos`} />
          ) : undefined}
          activity={canRide || rides.length > 0 ? <RideSection base={`${base}/ride`} rides={rides} planned={null} canUpload={canRide} /> : undefined}
          secondaryActions={
            <>
              <p className="text-small text-muted-foreground">{t('copy')}</p>
              <RemoteModeration id={o.id} actorId={o.organizer.actorId} domain={o.organizer.domain} />
            </>
          }
        />
      </main>
      <AppNav />
    </>
  );
}
