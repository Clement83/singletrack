import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, History } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { AppNav } from '@/components/app-nav';
import { HistoryMap } from '@/components/outings/history-map';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/current-user';
import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';
import { listHistory } from '@/lib/outings';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('history'), robots: { index: false, follow: false } };
}

const day = (d: Date, locale: string) => d.toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' });

// « Nos sorties » (#1411) : sorties terminées, cumul km / D+, et ce qu'on a fait avec chaque pote.
export default async function Page() {
  const user = await requireUser();
  const { entries, totals, byPal } = listHistory(getDb().db, user.id);
  const t = await getTranslations('history');
  const locale = (await getLocale()) as 'fr' | 'en';
  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        <PageHeader title={t('title')} />
        <Link href="/sorties" className="flex min-h-touch items-center gap-2 text-body font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">
          <ArrowLeft aria-hidden className="size-5" /> {t('back')}
        </Link>
        {entries.length === 0 ? (
          <EmptyState icon={History} title={t('emptyTitle')} action={<Button asChild size="lg"><Link href="/sorties">{t('emptyAction')}</Link></Button>}>
            {t('emptyBody')}
          </EmptyState>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-2">
              {[
                [t('totalOutings', { n: totals.outings }), null],
                [formatKm(totals.distanceM / 1000, locale), t('totalKm')],
                [formatElevation(totals.gainM, locale), t('totalGain')],
              ].map(([v, l], i) => (
                <div key={i} className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-3 shadow-sm">
                  <dt className="text-small text-muted-foreground">{l ?? ' '}</dt>
                  <dd className="text-heading tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <section aria-label={t('mapTitle')} className="flex flex-col gap-2">
              <h2 className="text-heading">{t('mapTitle')}</h2>
              <HistoryMap routes={entries.map((e) => ({ id: e.slug, geometry: e.geometry, bbox: e.bbox }))} label={t('mapLabel')} />
            </section>
            <section aria-label={t('listTitle')} className="flex flex-col gap-3">
              <h2 className="text-heading">{t('listTitle')}</h2>
              <ul className="flex flex-col gap-3">
                {entries.map((e) => (
                  <li key={e.slug}>
                    <Link href={`/s/${e.slug}`} className="flex min-h-touch flex-col gap-1 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors duration-150 hover:bg-accent/40 active:bg-accent/60">
                      <span className="text-small text-muted-foreground">{formatOutingDate(e.startsAt, locale)}</span>
                      <span className="text-heading break-words">{e.title}</span>
                      <span className="text-small tabular-nums">{formatKm(e.distanceM / 1000, locale)} · {formatElevation(e.gainM, locale)}</span>
                      <span className="text-small text-muted-foreground break-words">
                        {e.participants.length ? t('with', { names: new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(e.participants) }) : t('alone')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-label={t('palsTitle')} className="flex flex-col gap-3">
              <h2 className="text-heading">{t('palsTitle')}</h2>
              {byPal.length === 0 ? (
                <p className="text-muted-foreground">{t('noPals')}</p>
              ) : (
                <>
                  <p className="text-small text-muted-foreground">{t('palsHint')}</p>
                  <ul className="flex flex-col gap-2">
                    {byPal.map((p) => (
                      <li key={p.contactId} className="flex min-h-touch items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
                        <div className="flex min-w-0 flex-col">
                          <span className="text-body font-semibold break-words">{p.name}</span>
                          <span className="text-small text-muted-foreground">{t('palLast', { date: day(p.lastAt, locale) })}</span>
                        </div>
                        <div className="flex shrink-0 flex-col items-end text-small tabular-nums">
                          <span className="font-semibold">{t('palOutings', { n: p.outings })}</span>
                          <span className="text-muted-foreground">{formatKm(p.distanceM / 1000, locale)} · {formatElevation(p.gainM, locale)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </>
        )}
      </main>
      <AppNav />
    </>
  );
}
