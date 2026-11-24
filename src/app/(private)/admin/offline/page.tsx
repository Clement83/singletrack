import fs from 'node:fs';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { AppNav } from '@/components/app-nav';
import { PageHeader } from '@/components/page-header';
import { AdminOffline } from '@/components/admin/admin-offline';
import { requireUser } from '@/lib/current-user';
import { isAdmin } from '@/lib/admin';
import { REGION_CATALOG } from '@/lib/offline/regions';
import { adminSwitch, envPacksEnabled, listRegions, offlineDir } from '@/lib/offline/store';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('admin.offline'))('metaTitle'), robots: { index: false, follow: false } };
}

// Offline packs (#1738): restricted to `ADMIN_EMAILS` (404 for everyone else).
export default async function Page() {
  const me = await requireUser();
  if (!isAdmin(me)) notFound();
  const t = await getTranslations('admin.offline');
  const { db } = getDb();
  let freeBytes: number | null = null;
  try { fs.mkdirSync(offlineDir(), { recursive: true }); const s = fs.statfsSync(offlineDir()); freeBytes = s.bavail * s.bsize; } catch { /* unknown */ }
  const regions = listRegions(db).map((r) => ({ ...r, builtAt: r.builtAt?.toISOString() ?? null }));
  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        <PageHeader title={t('title')} />
        <AdminOffline
          envEnabled={envPacksEnabled()} switchOn={adminSwitch(db)} freeBytes={freeBytes} regions={regions}
          catalog={REGION_CATALOG.map((c) => ({ id: c.id, name: c.name }))}
        />
      </main>
      <AppNav />
    </>
  );
}
