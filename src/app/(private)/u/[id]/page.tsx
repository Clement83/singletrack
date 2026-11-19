import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft, Bike } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { AppNav } from '@/components/app-nav';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/current-user';
import { formatElevation, formatKm } from '@/lib/format';
import { getProfile, type ProfileRide } from '@/lib/user-profile';
import { initialOf } from '@/components/user-menu';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('profile'), robots: { index: false, follow: false } };
}

// A user's profile (#1433): 404 if the visitor is not allowed to see it (private and not friends).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const p = getProfile(getDb().db, me.id, id);
  if (!p) notFound();
  const t = await getTranslations('userProfile');
  const locale = (await getLocale()) as 'fr' | 'en';
  const day = (d: Date) => d.toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' });

  const row = (r: ProfileRide, i: number) => {
    const body = (
      <>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-heading">{r.title}</span>
          <span className="block text-small text-muted-foreground">{day(r.startsAt)}{r.withViewer ? ` · ${t('withYou')}` : ''}</span>
        </span>
        <span className="text-body tabular-nums">{formatKm(r.distanceM / 1000, locale)}</span>
      </>
    );
    const cls = 'flex min-h-touch items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm';
    return (
      <li key={`${r.slug ?? 'r'}-${i}`}>
        {r.slug
          ? <Link href={`/s/${r.slug}`} className={`${cls} hover:bg-muted active:opacity-80`}>{body}</Link>
          : <div className={cls}>{body}</div>}
      </li>
    );
  };

  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        <PageHeader title={p.name} />
        <Link href="/copains" className="flex min-h-touch items-center gap-2 text-body font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">
          <ArrowLeft aria-hidden className="size-5" /> {t('back')}
        </Link>
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-14 items-center justify-center rounded-full bg-primary text-heading text-primary-foreground">{initialOf(p.name)}</span>
          <p className="text-small text-muted-foreground">
            {p.isSelf ? t('yours', { visibility: t(p.visibility) }) : p.isFriend ? t('friend') : t('publicProfile')}
          </p>
        </div>
        {p.totals.outings === 0 ? (
          <EmptyState icon={Bike} title={t('emptyTitle')}>{t('emptyBody')}</EmptyState>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                [t('outings', { n: p.totals.outings }), t('statOutings')],
                [formatKm(p.totals.distanceM / 1000, locale), t('statKm')],
                [formatElevation(p.totals.gainM, locale), t('statGain')],
                [p.totals.lastAt ? day(p.totals.lastAt) : '–', t('statLast')],
              ].map(([v, l]) => (
                <div key={l} className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-3 shadow-sm">
                  <dt className="text-small text-muted-foreground">{l}</dt>
                  <dd className="text-heading tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            {p.shared.length > 0 && (
              <section aria-label={t('sharedTitle')} className="flex flex-col gap-3">
                <h2 className="text-heading">{t('sharedTitle')}</h2>
                <ul className="flex flex-col gap-3">{p.shared.map(row)}</ul>
              </section>
            )}
            <section aria-label={t('listTitle')} className="flex flex-col gap-3">
              <h2 className="text-heading">{t('listTitle')}</h2>
              <ul className="flex flex-col gap-3">{p.rides.map(row)}</ul>
            </section>
          </>
        )}
      </main>
      <AppNav />
    </>
  );
}
