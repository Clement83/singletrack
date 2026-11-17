import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AppNav } from '@/components/app-nav';
import { GpxImporter } from '@/components/tracks/gpx-importer';
import { getDb } from '@/db';
import { requireUser } from '@/lib/current-user';
import { getDefaultTrackVisibility } from '@/lib/user-profile';
import { PageHeader } from '@/components/page-header';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('importer'))('metaTitle'), robots: { index: false, follow: false } };
}

export default async function ImportPage() {
  const t = await getTranslations('importer');
  const user = await requireUser();
  return (
    <>
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-gutter pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(var(--spacing-nav)+2rem)] lg:pl-[calc(var(--spacing-rail)+1.5rem)] lg:pt-8">
        <PageHeader title={t('title')}>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </PageHeader>
        <GpxImporter defaultVisibility={getDefaultTrackVisibility(getDb().db, user.id, 'imported')} />
      </main>
      <AppNav />
    </>
  );
}
