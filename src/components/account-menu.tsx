import { getDb } from '@/db';
import { getVisibility, getDefaultOutingVisibility, getDefaultTrackVisibility } from '@/lib/user-profile';
import { UserMenu } from '@/components/user-menu';
import { SignInButton } from '@/components/sign-in-button';
import { federationEnabled, fedAddress } from '@/lib/federation/config';
import { getHandle } from '@/lib/federation/handle';
import { config } from '@/lib/config';

/** Position commune (#1397) : en haut à gauche sur mobile, en bas de la barre latérale (centré dans ses 80 px) en desktop. */
const PLACE = 'fixed top-[calc(0.75rem+env(safe-area-inset-top))] left-3 z-20 lg:top-auto lg:bottom-4 lg:left-[calc((var(--spacing-rail)-var(--spacing-touch))/2)] lg:z-40';

/** Menu utilisateur du connecté ; visiteur sans compte (#1591) : bouton « Se connecter » à la même place. */
export function AccountMenu({ user }: { user: { id: string; name: string; email: string } | null }) {
  if (!user) return <SignInButton className={PLACE} />;
  const db = getDb().db;
  const { handle, canChange } = getHandle(db, user.id);
  const fed = handle && federationEnabled() ? { handle, address: fedAddress(handle), canChange } : null; // adresse fédérée (#1474), visible seulement si la fédération est active
  return (
    <UserMenu
      user={{ id: user.id, name: user.name, email: user.email, profileVisibility: getVisibility(db, user.id), outingVisibility: getDefaultOutingVisibility(db, user.id), drawnTrackVisibility: getDefaultTrackVisibility(db, user.id, 'drawn'), importedTrackVisibility: getDefaultTrackVisibility(db, user.id, 'imported'), fed }}
      sourceUrl={config.sourceUrl}
      version={config.version}
      className={PLACE}
    />
  );
}
