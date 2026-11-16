import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { AppNav } from '@/components/app-nav';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { DiscoveryMap } from '@/components/outings/discovery-map';
import { JoinOutingButton } from '@/components/outings/join-outing-button';
import { requireUser } from '@/lib/current-user';
import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';
import { getOutingDiscovery } from '@/lib/outings';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('outings'), robots: { index: false, follow: false } };
}

// Fiche de découverte (#1461) : désignée par l'id (jamais le slug organisateur). Déjà rattaché ⇒ sa page.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const res = getOutingDiscovery(getDb().db, user.id, id);
  if (res.kind === 'notFound') notFound();
  if (res.kind === 'redirect') redirect(res.path);
  const { outing: o } = res;
  const [t, tl, tm, te, locale] = await Promise.all([getTranslations('outingsMap'), getTranslations('outingLabels'), getTranslations('outings'), getTranslations('errors'), getLocale()]);
  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        <PageHeader title={o.title} />
        <Link href="/" className="flex min-h-touch items-center gap-2 text-body font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">
          <ArrowLeft aria-hidden className="size-5" /> {t('back')}
        </Link>
        <p className="text-heading tabular-nums">{formatOutingDate(o.startsAt, locale)}</p>
        <p className="text-small text-muted-foreground">{tm('openBy', { name: o.organizerName })}{o.meetingLabel ? ` · ${t('meeting', { place: o.meetingLabel })}` : ''}</p>
        <p className="text-body tabular-nums">{formatKm(o.distanceM / 1000, locale)}{o.gainM != null ? ` · ${formatElevation(o.gainM, locale)}` : ''}</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="primary">{tl(`level.${o.level}`)}</Badge>
          <Badge variant="outline">{tl(`ebike.${o.ebike}`)}</Badge>
          <Badge variant="outline">{t('going', { n: o.yesCount })}</Badge>
          {o.spotsLeft != null && <Badge variant={o.spotsLeft === 0 ? 'danger' : 'outline'}>{t('spots', { n: o.spotsLeft })}</Badge>}
        </div>
        {o.description && <p className="text-body break-words whitespace-pre-line">{o.description}</p>}
        <DiscoveryMap geometry={o.geometry} meeting={[o.lon, o.lat]} label={t('mapLabel')} />
        {res.canJoin && <JoinOutingButton outingId={o.id} mode="join" />}
        {res.full && <p className="text-small text-muted-foreground">{te('full')}</p>}
      </main>
      <AppNav />
    </>
  );
}
