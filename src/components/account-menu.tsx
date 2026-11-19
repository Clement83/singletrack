import { getDb } from '@/db';
import { getVisibility, getDefaultOutingVisibility, getDefaultTrackVisibility, getCharte } from '@/lib/user-profile';
import { UserMenu } from '@/components/user-menu';
import { SignInButton } from '@/components/sign-in-button';
import { federationEnabled, fedAddress } from '@/lib/federation/config';
import { getHandle } from '@/lib/federation/handle';
import { config } from '@/lib/config';

/** Shared position (#1397): top left on mobile, at the bottom of the side bar (centred in its 80 px) on desktop. */
const PLACE = 'fixed top-[calc(0.75rem+env(safe-area-inset-top))] left-3 z-20 lg:top-auto lg:bottom-4 lg:left-[calc((var(--spacing-rail)-var(--spacing-touch))/2)] lg:z-40';

/** User menu when signed in; visitor without an account (#1591): "Sign in" button at the same place. */
export function AccountMenu({ user }: { user: { id: string; name: string; email: string } | null }) {
  if (!user) return <SignInButton className={PLACE} />;
  const db = getDb().db;
  const { handle, canChange } = getHandle(db, user.id);
  const fed = handle && federationEnabled() ? { handle, address: fedAddress(handle), canChange } : null; // federated address (#1474), only shown if federation is on
  return (
    <UserMenu
      user={{ id: user.id, name: user.name, email: user.email, profileVisibility: getVisibility(db, user.id), outingVisibility: getDefaultOutingVisibility(db, user.id), drawnTrackVisibility: getDefaultTrackVisibility(db, user.id, 'drawn'), importedTrackVisibility: getDefaultTrackVisibility(db, user.id, 'imported'), charte: getCharte(db, user.id), fed }}
      sourceUrl={config.sourceUrl}
      version={config.version}
      className={PLACE}
    />
  );
}
