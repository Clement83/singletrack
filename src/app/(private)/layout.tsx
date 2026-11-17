import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/current-user';
import { AccountMenu } from '@/components/account-menu';
import { ClientMessages } from '@/i18n/client-messages';

export const dynamic = 'force-dynamic';

// Zone réservée au connecté (#1344). Le proxy filtre sur le cookie ; ici la session est vérifiée pour de bon.
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!user.name) redirect('/bienvenue'); // nouveau compte sans prénom (#1377)
  return (
    <ClientMessages zone="private">
      {children}
      <AccountMenu user={user} />
    </ClientMessages>
  );
}
