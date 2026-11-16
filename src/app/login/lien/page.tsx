import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/auth-shell';
import { LinkSignIn } from './link-sign-in';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('title'), robots: { index: false, follow: false } };
}

// Ouverte depuis le lien ou le QR code du mail (#1377). Le code est dans le fragment (#) : lu côté client.
export default async function LinkSignInPage() {
  const t = await getTranslations('auth.link');
  return (
    <AuthShell subtitle={t('subtitle')}>
      <LinkSignIn />
    </AuthShell>
  );
}
