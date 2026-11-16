import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { AppNav } from '@/components/app-nav';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { RemoteAnswer } from '@/components/outings/remote-answer';
import { RemoteModeration } from '@/components/federation/remote-moderation';
import { requireUser } from '@/lib/current-user';
import { listRemoteOutings } from '@/lib/federation/outings';
import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('outings'), robots: { index: false, follow: false } };
}

// Sortie d'un autre serveur (#1476) : copie en cache, l'organisateur reste la référence. Météo, carte et trace viendront de la copie.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const o = listRemoteOutings(getDb().db, user.id, { id: (await params).id })[0];
  if (!o) notFound();
  const [t, tl, locale] = await Promise.all([getTranslations('remoteOutings'), getTranslations('outingLabels'), getLocale()]);
  const answerable = o.status === 'planned' && !o.closed;
  const stateText = o.state === 'none' ? null
    : o.state === 'rejected' ? t(`state.rejected.${o.reason === 'full' || o.reason === 'closed' || o.reason === 'forbidden' ? o.reason : 'other'}`, { domain: o.organizer.domain })
    : t(`state.${o.state}`, { domain: o.organizer.domain });
  const track = o.track;
  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        <PageHeader title={o.title} />
        <Link href="/sorties" className="flex min-h-touch items-center gap-2 text-body font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">
          <ArrowLeft aria-hidden className="size-5" /> {t('back')}
        </Link>
        <p className="text-heading tabular-nums">{formatOutingDate(o.startsAt, locale)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t('badge', { domain: o.organizer.domain })}</Badge>
          {o.invited && <Badge variant="primary">{t('invited')}</Badge>}
        </div>
        <p className="text-small text-muted-foreground">
          <a href={o.organizer.profileUrl} rel="noopener noreferrer nofollow" className="underline underline-offset-4">{t('by', { name: o.organizer.name, domain: o.organizer.domain })}</a>
          {o.label ? ` · ${t('meeting', { place: o.label })}` : ''}
        </p>
        {track && <p className="text-body tabular-nums">{formatKm(track.distanceM / 1000, locale)}{track.elevationGainM != null ? ` · ${formatElevation(track.elevationGainM, locale)}` : ''}</p>}
        {o.description && <p className="whitespace-pre-line break-words text-body">{o.description}</p>}
        <div className="flex flex-wrap gap-2">
          <Badge variant="primary">{tl(`level.${o.level}`)}</Badge>
          <Badge variant="outline">{tl(`ebike.${o.ebike}`)}</Badge>
          <Badge variant="outline">{t('going', { n: o.yesCount })}</Badge>
          {o.spotsLeft != null && <Badge variant={o.spotsLeft === 0 ? 'danger' : 'outline'}>{t('spots', { n: o.spotsLeft })}</Badge>}
        </div>
        {track?.attribution && <p className="text-small text-muted-foreground">{track.attribution}{track.license ? ` · ${track.license}` : ''}</p>}
        {o.status === 'cancelled' ? <p className="rounded-2xl border border-border bg-accent/40 p-3 text-body">{t('cancelled')}</p>
          : answerable ? <RemoteAnswer id={o.id} current={o.answer} domain={o.organizer.domain} />
          : <p className="text-muted-foreground">{t('closed')}</p>}
        {o.answer !== 'pending' && <p className="text-small">{t('yourAnswer', { answer: t(`answers.${o.answer}`) })}{stateText ? ` — ${stateText}` : ''}</p>}
        <p className="text-small text-muted-foreground">{t('copy')}</p>
        <RemoteModeration id={o.id} actorId={o.organizer.actorId} domain={o.organizer.domain} />
      </main>
      <AppNav />
    </>
  );
}
