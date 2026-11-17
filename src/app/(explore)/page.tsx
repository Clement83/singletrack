import { Suspense } from 'react';
import { AppNav } from '@/components/app-nav';
import { TrackExplorer } from '@/components/tracks/track-explorer';
import { config } from '@/lib/config';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

// Explorateur de traces (#1346) : carte plein écran ; barre du bas (mobile) ou latérale (≥ 1024 px) par-dessus.
// Publique depuis #1591 : un visiteur sans compte explore les traces publiques (mode visiteur, `signedIn=false`).
export default async function Home() {
  const signedIn = !!(await getCurrentUser());
  return (
    <main className="fixed inset-x-0 top-0 bottom-[calc(var(--spacing-nav)+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-[var(--spacing-rail)]">
      <Suspense>
        <TrackExplorer home={{ lat: config.homeLat, lon: config.homeLon }} signedIn={signedIn} />
      </Suspense>
      <AppNav />
    </main>
  );
}
