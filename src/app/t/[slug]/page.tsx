import { BackToMap } from '@/components/tracks/back-to-map';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BadgeCheck, CalendarPlus, Clock, Copy, Pencil, PencilLine, Download, ExternalLink, Mountain, MoveDown, Route, TrendingDown, TrendingUp } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { TrackDetail } from '@/components/tracks/track-detail';
import { Badge, DifficultyBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/current-user';
import { formatDuration, formatKm, formatMeters, formatOutingDate } from '@/lib/format';
import { outingsOfTrack } from '@/lib/outings';
import { lines, profileOf, simplifyGeometry } from '@/lib/geo';
import { DeleteTrackButton } from '@/components/tracks/delete-track';
import { canEditInPlace, ensureTrackElevation, estimateDurationMin, getVisibleTrack } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

const PROFILE_POINTS = 240;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const user = await getCurrentUser().catch(() => null);
  const t = getVisibleTrack(getDb().db, (await params).slug, user?.id);
  const tr = await getTranslations('track');
  return { title: t ? tr('metaTitle', { name: t.name || tr('untitled') }) : tr('notFound'), robots: { index: false, follow: false } };
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted p-3">
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-small text-muted-foreground">{label}</dt>
        <dd className="text-heading tabular-nums">{value}</dd>
      </div>
    </div>
  );
}


export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser().catch(() => null);
  // Brouillon (#1450) : 404 pour tout autre que son auteur.
  const found = getVisibleTrack(getDb().db, slug, user?.id);
  if (!found) notFound();
  const t = await ensureTrackElevation(getDb().db, found); // altitude IGN à la première ouverture (#1428)
  const draft = t.status === 'draft';
  const tr = await getTranslations('track');
  const locale = await getLocale();
  const m = (v: number | null) => formatMeters(v, locale);

  // Carte : géométrie à 5 m ; profil : ~240 points régulièrement échantillonnés avec leur position.
  const geometry = simplifyGeometry(t.geometry, 5);
  const coords = lines(t.geometry).flat();
  const full = profileOf(coords);
  const withEle = coords.filter((p) => typeof p[2] === 'number');
  const step = Math.max(1, Math.floor(full.length / PROFILE_POINTS));
  const profile = full
    .map((p, i) => ({ ...p, lon: withEle[i][0], lat: withEle[i][1] }))
    .filter((_, i, a) => i % step === 0 || i === a.length - 1);
  const ls = lines(t.geometry);
  const end = ls[ls.length - 1].at(-1)!;
  const mine = !!user && canEditInPlace(t, user.id);
  const outings = user ? outingsOfTrack(getDb().db, user.id, t.id) : [];
  const duration = estimateDurationMin(t.distanceM, t.elevationGainM);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-4 pb-32">
      {user && (
        <BackToMap className="flex min-h-touch items-center gap-2 text-body font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">
          <ArrowLeft aria-hidden className="size-5" /> {tr('back')}
        </BackToMap>
      )}
      <header className="flex flex-col gap-2">
        <h1 className="text-title">{t.name || tr('untitled')}</h1>
        <div className="flex flex-wrap gap-2">
          {draft && <Badge variant="outline"><PencilLine aria-hidden className="size-4" /> {tr('draft')}</Badge>}
          {t.difficulty && <DifficultyBadge level={t.difficulty} />}
          {t.source === 'geotrek' && <Badge variant="outline"><BadgeCheck aria-hidden className="size-4" /> {tr('official')}</Badge>}
          {t.loop ? <Badge>{tr('loop')}</Badge> : <Badge variant="outline">{tr('oneway')}</Badge>}
        </div>
      </header>

      <TrackDetail
        geometry={geometry}
        bbox={[t.bboxMinLon, t.bboxMinLat, t.bboxMaxLon, t.bboxMaxLat]}
        start={[t.startLon, t.startLat]}
        end={[end[0], end[1]]}
        profile={profile}
      />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat icon={Route} label={tr('stats.distance')} value={formatKm(t.distanceM / 1000, locale)} />
        <Stat icon={TrendingUp} label={tr('stats.gain')} value={m(t.elevationGainM)} />
        <Stat icon={TrendingDown} label={tr('stats.loss')} value={m(t.elevationLossM)} />
        <Stat icon={MoveDown} label={tr('stats.minEle')} value={m(t.minEle)} />
        <Stat icon={Mountain} label={tr('stats.maxEle')} value={m(t.maxEle)} />
        <Stat icon={Clock} label={tr('stats.duration')} value={formatDuration(duration, locale)} />
      </dl>
      <p className="-mt-2 text-small text-muted-foreground">{tr('durationHint')}</p>

      {t.description && <p className="text-body whitespace-pre-line">{t.description}</p>}

      <section aria-label={tr('sourceRegion')} className="rounded-2xl border border-border p-4 text-small text-muted-foreground">
        <p>
          {tr('source', { source: tr(`sources.${t.source}`) })}
          {t.author ? ` · ${t.author}` : ''}
          {t.license ? ` · ${tr('license', { license: t.license })}` : ''}
        </p>
        {t.attribution && <p className="mt-1">{t.attribution}</p>}
        {t.sourceUrl && (
          <a href={t.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-touch items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">
            {tr('seeSource')} <ExternalLink aria-hidden className="size-4" />
          </a>
        )}
      </section>

      {user && (
        <div className="grid gap-2 sm:grid-cols-2">
          {mine && (
            <Button asChild variant="outline"><Link href={`/t/${t.slug}/edit`}><Pencil aria-hidden /> {tr('edit')}</Link></Button>
          )}
          {!draft && <Button asChild variant="outline"><Link href={`/t/${t.slug}/edit?copie=1`}><Copy aria-hidden /> {tr('editCopy')}</Link></Button>}
          {draft ? (
            <Button asChild><Link href={`/t/${t.slug}/edit`}><Pencil aria-hidden /> {tr('continueDraft')}</Link></Button>
          ) : (
            <Button asChild><Link href={`/sorties/nouvelle?trace=${t.slug}`}><CalendarPlus aria-hidden /> {tr('createOuting')}</Link></Button>
          )}
          {mine && <DeleteTrackButton slug={t.slug} name={t.name || tr('untitled')} />}
        </div>
      )}

      {user && outings.length > 0 && (
        <section aria-label={tr('outingsRegion')} className="flex flex-col gap-2">
          <h2 className="text-heading">{tr('outingsOn')}</h2>
          <ul className="flex flex-col gap-2">
            {outings.map((o) => (
              <li key={o.id}>
                <Link href={`/s/${o.slug}`} className="flex min-h-touch items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-2 transition-colors duration-150 hover:bg-accent/40 active:bg-accent/60">
                  <span className="font-semibold">{o.title}</span>
                  <span className="text-small text-muted-foreground">{formatOutingDate(o.startsAt, locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <div className="flex gap-2">
          <Button asChild size="lg">
            <a href={`/api/t/${t.slug}/gpx`} download>
              <Download aria-hidden /> {tr('downloadGpx')}
            </a>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-auto shrink-0">
            <a href={`/api/t/${t.slug}/kml`} download aria-label={tr('downloadKmlLabel')}>
              {tr('downloadKml')}
            </a>
          </Button>
        </div>
      </div>
    </main>
  );
}
