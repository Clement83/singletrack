import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { AppNav } from '@/components/app-nav';
import { FriendsScreen } from '@/components/friends/friends-screen';
import { requireUser } from '@/lib/current-user';
import { listFriends } from '@/lib/friends';
import { federationEnabled, fedAddress } from '@/lib/federation/config';
import { getHandle } from '@/lib/federation/handle';
import { listBlockedActors } from '@/lib/federation/moderation';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('friends'), robots: { index: false, follow: false } };
}

// Mes copains (#1432).
export default async function Page() {
  const user = await requireUser();
  const t = await getTranslations('friends');
  const v = listFriends(getDb().db, user.id);
  const handle = getHandle(getDb().db, user.id).handle;
  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        <PageHeader title={t('title')} />
        <Link href="/sorties/potes" className="flex min-h-touch items-center gap-2 text-body font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">
          <ArrowLeft aria-hidden className="size-5" /> {t('back')}
        </Link>
        <FriendsScreen {...v} blocked={listBlockedActors(getDb().db, user.id)} federation={federationEnabled()} myAddress={federationEnabled() && handle ? fedAddress(handle) : null} />
      </main>
      <AppNav />
    </>
  );
}
