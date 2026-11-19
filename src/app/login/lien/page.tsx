import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/auth-shell';
import { LinkSignIn } from './link-sign-in';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('title'), robots: { index: false, follow: false } };
}

// Opened from the email's link or QR code (#1377). The code is in the fragment (#): read on the client.
export default async function LinkSignInPage() {
  const t = await getTranslations('auth.link');
  return (
    <AuthShell subtitle={t('subtitle')}>
      <LinkSignIn />
    </AuthShell>
  );
}
