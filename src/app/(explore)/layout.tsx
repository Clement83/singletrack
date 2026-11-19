import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/current-user';
import { AccountMenu } from '@/components/account-menu';
import { ClientMessages } from '@/i18n/client-messages';

export const dynamic = 'force-dynamic';

// Track map (#1591): open without an account. The visitor only sees public data (API filtering, #1589);
// the signed-in user keeps everything (their tracks, their friends') and their menu.
export default async function ExploreLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (user && !user.name) redirect('/bienvenue'); // new account without a first name (#1377)
  return (
    <ClientMessages zone="private">
      {children}
      <AccountMenu user={user} />
    </ClientMessages>
  );
}
