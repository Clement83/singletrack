import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { safeNext } from '@/lib/safe-next';
import { LoginFlow } from './login-flow';
import { getCurrentUser } from '@/lib/current-user';
import { AuthShell } from '@/components/auth-shell';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await getCurrentUser()) redirect(next ?? '/');
  const t = await getTranslations('auth');
  return (
    <AuthShell subtitle={t('subtitle')}>
      <LoginFlow next={next} />
    </AuthShell>
  );
}
