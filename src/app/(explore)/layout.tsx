import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/current-user';
import { AccountMenu } from '@/components/account-menu';
import { ClientMessages } from '@/i18n/client-messages';

export const dynamic = 'force-dynamic';

// Carte des traces (#1591) : ouverte sans compte. Le visiteur ne voit que le public (filtrage côté API, #1589) ;
// le connecté garde tout (ses traces, celles de ses copains) et son menu.
export default async function ExploreLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (user && !user.name) redirect('/bienvenue'); // nouveau compte sans prénom (#1377)
  return (
    <ClientMessages zone="private">
      {children}
      <AccountMenu user={user} />
    </ClientMessages>
  );
}
