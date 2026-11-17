import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/current-user';
import { getDb } from '@/db';
import { getVisibility, getDefaultOutingVisibility, getDefaultTrackVisibility } from '@/lib/user-profile';
import { UserMenu } from '@/components/user-menu';
import { federationEnabled, fedAddress } from '@/lib/federation/config';
import { getHandle } from '@/lib/federation/handle';
import { config } from '@/lib/config';
import { ClientMessages } from '@/i18n/client-messages';

export const dynamic = 'force-dynamic';

// Zone réservée au connecté (#1344). Le proxy filtre sur le cookie ; ici la session est vérifiée pour de bon.
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!user.name) redirect('/bienvenue'); // nouveau compte sans prénom (#1377)
  const { handle, canChange } = getHandle(getDb().db, user.id);
  const fed = handle && federationEnabled() ? { handle, address: fedAddress(handle), canChange } : null; // adresse fédérée (#1474), visible seulement si la fédération est active
  return (
    <ClientMessages zone="private">
      {children}
      {/* Menu utilisateur (#1397) : en haut à gauche sur mobile, en bas de la barre latérale (centré dans ses 80 px) en desktop. */}
      <UserMenu
        user={{ id: user.id, name: user.name, email: user.email, profileVisibility: getVisibility(getDb().db, user.id), outingVisibility: getDefaultOutingVisibility(getDb().db, user.id), drawnTrackVisibility: getDefaultTrackVisibility(getDb().db, user.id, 'drawn'), importedTrackVisibility: getDefaultTrackVisibility(getDb().db, user.id, 'imported'), fed }}
        sourceUrl={config.sourceUrl}
        version={config.version}
        className="fixed top-[calc(0.75rem+env(safe-area-inset-top))] left-3 z-20 lg:top-auto lg:bottom-4 lg:left-[calc((var(--spacing-rail)-var(--spacing-touch))/2)] lg:z-40"
      />
    </ClientMessages>
  );
}
