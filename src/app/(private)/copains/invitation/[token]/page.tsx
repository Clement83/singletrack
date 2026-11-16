import Link from 'next/link';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { AppNav } from '@/components/app-nav';
import { AcceptInvite } from '@/components/friends/accept-invite';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/current-user';
import { peekInvite } from '@/lib/friends';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('friends'), robots: { index: false, follow: false } };
}

// Lien d'invitation copain à usage unique (#1432) : privé, il faut un compte (connexion sans mot de passe).
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  await requireUser();
  const { token } = await params;
  const t = await getTranslations('friends');
  const invite = peekInvite(getDb().db, token);
  return (
    <>
      <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-20 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        {invite ? (
          <>
            <h1 className="text-title">{t('inviteTitle', { name: invite.inviterName })}</h1>
            <p className="text-muted-foreground">{t('inviteBody')}</p>
            <AcceptInvite token={token} />
          </>
        ) : (
          <>
            <h1 className="text-title">{t('inviteGoneTitle')}</h1>
            <p className="text-muted-foreground">{t('inviteGone')}</p>
            <Button asChild variant="outline"><Link href="/copains">{t('title')}</Link></Button>
          </>
        )}
      </main>
      <AppNav />
    </>
  );
}
