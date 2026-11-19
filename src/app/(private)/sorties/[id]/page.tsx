import { BackToMap } from '@/components/tracks/back-to-map';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { AppNav } from '@/components/app-nav';
import { Badge } from '@/components/ui/badge';
import { OutingView } from '@/components/outings/outing-view';
import { JoinOutingButton } from '@/components/outings/join-outing-button';
import { requireUser } from '@/lib/current-user';
import { getOutingDiscovery } from '@/lib/outings';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('outings'), robots: { index: false, follow: false } };
}

// Fiche de découverte (#1461) : désignée par l'id (jamais le slug organisateur). Déjà rattaché ⇒ sa page.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const res = getOutingDiscovery(getDb().db, user.id, id);
  if (res.kind === 'notFound') notFound();
  if (res.kind === 'redirect') redirect(res.path);
  const { outing: o } = res;
  const [t, tm, te] = await Promise.all([getTranslations('outingsMap'), getTranslations('outings'), getTranslations('errors')]);
  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        <OutingView
          role="visitor"
          presentation="page"
          outing={{ title: o.title, startsAt: o.startsAt, level: o.level, ebike: o.ebike, meetingLabel: o.meetingLabel, meetingLat: o.lat, meetingLon: o.lon, description: o.description, visibility: o.visibility }}
          track={o.track}
          topLink={
            <BackToMap className="flex min-h-touch items-center gap-2 text-body font-medium text-primary underline-offset-4 hover:underline active:opacity-70">
              <ArrowLeft aria-hidden className="size-5" /> {t('back')}
            </BackToMap>
          }
          notices={
            <>
              <p className="text-small text-muted-foreground">{tm('openBy', { name: o.organizerName })}</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{t('going', { n: o.yesCount })}</Badge>
                {o.spotsLeft != null && <Badge variant={o.spotsLeft === 0 ? 'danger' : 'outline'}>{t('spots', { n: o.spotsLeft })}</Badge>}
              </div>
            </>
          }
          primaryAction={
            <>
              {res.canJoin && <JoinOutingButton outingId={o.id} mode="join" />}
              {res.full && <p className="text-small text-muted-foreground">{te('full')}</p>}
            </>
          }
        />
      </main>
      <AppNav />
    </>
  );
}
