import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { AppNav } from '@/components/app-nav';
import { ContactBook, type BookEntry } from '@/components/outings/contact-book';
import { requireUser } from '@/lib/current-user';
import { listFriends } from '@/lib/friends';
import { listContacts } from '@/lib/outings';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('contacts'), robots: { index: false, follow: false } };
}

const entry = (c: ReturnType<typeof listContacts>[number]): BookEntry => ({
  id: c.id, name: c.name, note: c.note, outings: c.outings, lastOutingAt: c.lastOutingAt?.toISOString() ?? null, userId: c.userId, remoteActorId: c.remoteActorId,
});

// Carnet de potes (#1359).
export default async function Page() {
  const user = await requireUser();
  const { db } = getDb();
  const t = await getTranslations('contacts');
  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        <PageHeader title={t('title')} />
        <Link href="/sorties" className="flex min-h-touch items-center gap-2 text-body font-medium text-primary underline-offset-4 hover:underline active:opacity-70">
          <ArrowLeft aria-hidden className="size-5" /> {t('back')}
        </Link>
        <ContactBook contacts={listContacts(db, user.id).map(entry)} archived={listContacts(db, user.id, { archived: true }).map(entry)} friends={listFriends(db, user.id).friends.map(({ userId, name, remote }) => ({ userId, remoteActorId: remote?.actorId ?? null, name, domain: remote?.domain ?? null }))} />
      </main>
      <AppNav />
    </>
  );
}
