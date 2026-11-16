import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { AppNav } from '@/components/app-nav';
import { PageHeader } from '@/components/page-header';
import { AdminBlocks } from '@/components/federation/admin-blocks';
import { requireUser } from '@/lib/current-user';
import { isAdminEmail, listBlockedDomains, listRefusals, listReports, type RefusalReason } from '@/lib/federation/moderation';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('moderation.admin'))('metaTitle'), robots: { index: false, follow: false } };
}

// Administration de la fédération (#1477) : réservée aux emails de `ADMIN_EMAILS` (404 pour les autres : la page n'existe pas pour eux).
export default async function Page() {
  const user = await requireUser();
  if (!isAdminEmail(user.email)) notFound();
  const [t, locale] = await Promise.all([getTranslations('moderation.admin'), getLocale()]);
  const { db } = getDb();
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });
  const reports = listReports(db);
  const refusals = listRefusals(db);
  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        <PageHeader title={t('title')} />
        <section aria-label={t('blocksTitle')} className="flex flex-col gap-3">
          <h2 className="text-heading">{t('blocksTitle')}</h2>
          <AdminBlocks blocks={listBlockedDomains(db).map((b) => ({ domain: b.domain, reason: b.reason, source: b.source }))} />
        </section>
        <section aria-label={t('reportsTitle')} className="flex flex-col gap-3">
          <h2 className="text-heading">{t('reportsTitle')}</h2>
          {reports.length === 0 && <p className="text-muted-foreground">{t('noReports')}</p>}
          <ul className="flex flex-col gap-3">
            {reports.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-body font-semibold break-words">{r.title}</p>
                <p className="text-small text-muted-foreground">{r.domain} · {when.format(r.createdAt)}</p>
                {r.reason && <p className="mt-1 whitespace-pre-line break-words text-body">{r.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label={t('logTitle')} className="flex flex-col gap-3">
          <h2 className="text-heading">{t('logTitle')}</h2>
          <p className="text-small text-muted-foreground">{t('logHint')}</p>
          {refusals.length === 0 && <p className="text-muted-foreground">{t('noRefusals')}</p>}
          <ul className="flex flex-col gap-2">
            {refusals.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3 text-small tabular-nums">
                <span className="text-muted-foreground">{when.format(r.at)}</span>
                <span className="break-all">{r.domain ?? '—'}</span>
                <span className="font-semibold">{t(`reasons.${r.reason as RefusalReason}`)}</span>
                {r.activity && <span className="text-muted-foreground">{r.activity}</span>}
              </li>
            ))}
          </ul>
        </section>
      </main>
      <AppNav />
    </>
  );
}
