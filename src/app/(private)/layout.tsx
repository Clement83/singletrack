import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/current-user';
import { AccountMenu } from '@/components/account-menu';
import { ClientMessages } from '@/i18n/client-messages';

export const dynamic = 'force-dynamic';

// Area for signed-in users (#1344). The proxy filters on the cookie; here the session is really verified.
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!user.name) redirect('/bienvenue'); // new account without a first name (#1377)
  return (
    <ClientMessages zone="private">
      {children}
      <AccountMenu user={user} />
    </ClientMessages>
  );
}
