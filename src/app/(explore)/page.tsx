import { Suspense } from 'react';
import { AppNav } from '@/components/app-nav';
import { TrackExplorer } from '@/components/tracks/track-explorer';
import { config } from '@/lib/config';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

// Track explorer (#1346): full-screen map; bottom bar (mobile) or side bar (≥ 1024 px) on top.
// Public since #1591: a visitor without an account explores the public tracks (visitor mode, `signedIn=false`).
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
