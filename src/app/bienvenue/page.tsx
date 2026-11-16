import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/current-user';
import { AuthShell } from '@/components/auth-shell';
import { safeNext } from '@/lib/safe-next';
import { WelcomeForm } from './welcome-form';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('welcome'))('metaTitle'), robots: { index: false, follow: false } };
}

// Première connexion d'un nouveau compte (#1377) : on demande juste le prénom.
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const user = await requireUser();
  if (user.name) redirect(next ?? '/');
  const t = await getTranslations('welcome');
  return (
    <AuthShell subtitle={t('subtitle')}>
      <WelcomeForm next={next} />
    </AuthShell>
  );
}
