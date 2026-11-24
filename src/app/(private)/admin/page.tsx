import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { count } from 'drizzle-orm';
import { ChevronRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { user as userTable } from '@/db/schema';
import { AppNav } from '@/components/app-nav';
import { PageHeader } from '@/components/page-header';
import { requireUser } from '@/lib/current-user';
import { isAdmin } from '@/lib/admin';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('admin'))('metaTitle'), robots: { index: false, follow: false } };
}

// Instance administration (#1737): restricted to `ADMIN_EMAILS` (404 for everyone else, the page does not exist for them).
// Sections are listed in SECTIONS; later tickets add theirs.
const SECTIONS = [
  { href: '/admin/federation', label: 'federation', hint: 'federationHint' },
  { href: '/admin/offline', label: 'offlineTitle', hint: 'offlineHint' },
] as const;

export default async function Page() {
  const me = await requireUser();
  if (!isAdmin(me)) notFound();
  const t = await getTranslations('admin');
  const { db } = getDb();
  const accounts = db.select({ n: count() }).from(userTable).get()?.n ?? 0;
  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        <PageHeader title={t('title')} />
        <section aria-label={t('instance')} className="flex flex-col gap-3">
          <h2 className="text-heading">{t('instance')}</h2>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <dt className="text-small text-muted-foreground">{t('version')}</dt>
              <dd className="text-heading tabular-nums">{config.version}</dd>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <dt className="text-small text-muted-foreground">{t('accounts')}</dt>
              <dd className="text-heading tabular-nums">{accounts}</dd>
            </div>
          </dl>
        </section>
        <nav aria-label={t('sections')} className="flex flex-col gap-2">
          <h2 className="text-heading">{t('sections')}</h2>
          <ul className="flex flex-col gap-2">
            {SECTIONS.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className="press flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
                  <span className="min-w-0">
                    <span className="block text-body font-medium">{t(s.label)}</span>
                    <span className="block text-small text-muted-foreground">{t(s.hint)}</span>
                  </span>
                  <ChevronRight aria-hidden className="size-[18px] shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <AppNav />
    </>
  );
}
