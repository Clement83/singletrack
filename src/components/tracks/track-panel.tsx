'use client';

import Link from 'next/link';
import { LoginLink } from '@/components/login-link';
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { Marker, type MapRef } from 'react-map-gl/maplibre';
import { ArrowLeft, BadgeCheck, CalendarPlus, Clock, Copy, Download, Ellipsis, ExternalLink, Flag, HelpCircle, Mountain, MoveDown, Pencil, PencilLine, Route, Share2, TrendingDown, TrendingUp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ElevationProfile } from '@/components/elevation-profile';
import { SlopeRouteLayer } from '@/components/map/slope-route-layer';
import { KmMarkers } from '@/components/map/km-markers';
import { ProfileCursorMarker } from '@/components/map/profile-cursor-marker';
import { Badge, DifficultyBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDuration, formatKm, formatMeters, formatOutingDate } from '@/lib/format';
import { slopeFeatures } from '@/lib/geo/slope-features';
import type { TrackSheet } from '@/lib/tracks/sheet';
import { cn } from '@/lib/utils';
import { DeleteTrackButton } from './delete-track';
import { TrackVisibilityBadge, TrackVisibilityChips, type TrackVisibilityValue } from './track-visibility';
import type { MapColors } from './use-map-colors';

/** Fiche telle que la renvoie `GET /api/tracks/<slug>` (#1581) : dates en texte, sans `updatedAt`. */
export type PanelSheet = Omit<TrackSheet, 'updatedAt' | 'outings'> & { outings: { slug: string; title: string; startsAt: string }[] };

/** Ce qu'il faut pour dessiner un parcours ouvert : une trace (#1582) ou le parcours figé d'une sortie (#1596). */
export type OpenLine = Pick<PanelSheet, 'geometry' | 'profile' | 'end' | 'bbox'>;

type SheetState = { slug: string; sheet?: PanelSheet; error?: boolean };

/** Fiche complète de la trace ouverte dans le panneau de la carte (#1582), chargée à la demande. */
export function useTrackSheet(slug: string | null) {
  const [state, setState] = useState<SheetState | null>(null);
  useEffect(() => {
    if (!slug) return;
    const ctl = new AbortController();
    fetch(`/api/tracks/${encodeURIComponent(slug)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((sheet: PanelSheet) => setState({ slug, sheet }))
      .catch((e) => e.name !== 'AbortError' && setState({ slug, error: true }));
    return () => ctl.abort();
  }, [slug]);
  const current = slug && state?.slug === slug ? state : null;
  /** Remplace la visibilité affichée après un changement réussi (#1590), sans recharger la fiche. */
  const setVisibility = (visibility: NonNullable<PanelSheet['visibility']>) =>
    setState((s) => (s?.sheet && s.slug === slug ? { ...s, sheet: { ...s.sheet, visibility } } : s));
  return { sheet: current?.sheet, error: !!current?.error, loading: !!slug && !current, setVisibility };
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-2xl bg-muted p-2.5">
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="truncate text-caption text-muted-foreground">{label}</dt>
        <dd className="text-body font-semibold tabular-nums">{value}</dd>
      </div>
    </div>
  );
}

/** Bouton « ? » des sources : s'ouvre au survol (souris) **et** au tap / clavier ; Échap ou un clic ailleurs le ferme. */
function SourceInfo({ sheet }: { sheet: PanelSheet }) {
  const t = useTranslations('track');
  const tp = useTranslations('explorer.panel');
  const [open, setOpen] = useState<false | 'hover' | 'click'>(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (open !== 'click') return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <div
      ref={box}
      className="relative"
      onMouseEnter={() => setOpen((o) => o || 'hover')}
      onMouseLeave={() => setOpen((o) => (o === 'hover' ? false : o))}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      <Button variant="ghost" size="icon" aria-label={tp('sourceInfo')} aria-expanded={!!open} aria-controls={id} onClick={() => setOpen((o) => (o === 'click' ? false : 'click'))}>
        <HelpCircle aria-hidden />
      </Button>
      {open && (
        <div id={id} role="note" className="absolute top-full right-0 z-10 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card p-4 text-small text-card-foreground shadow-md">
          <p className="font-semibold">{t('source', { source: t(`sources.${sheet.source}`) })}</p>
          {(sheet.author || sheet.license) && (
            <p className="mt-1 text-muted-foreground">
              {sheet.author}
              {sheet.author && sheet.license ? ' · ' : ''}
              {sheet.license ? t('license', { license: sheet.license }) : ''}
            </p>
          )}
          {sheet.attribution && <p className="mt-1 text-muted-foreground">{sheet.attribution}</p>}
          {sheet.sourceUrl && (
            <a href={sheet.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-touch items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">
              {t('seeSource')} <ExternalLink aria-hidden className="size-4" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Contenu du panneau : retour, badges, sources, stats, description, sorties prévues. */
export function TrackPanelBody({ sheet, loading, error, backLabel, onBack }: { sheet?: PanelSheet; loading: boolean; error: boolean; backLabel?: string; onBack?: () => void }) {
  const t = useTranslations('track');
  const tp = useTranslations('explorer.panel');
  const locale = useLocale();
  const m = (v: number | null) => formatMeters(v, locale);
  const visibility = sheet?.visibility;
  return (
    <div className="flex flex-col gap-3" data-testid="track-panel">
      {onBack && backLabel && (
        <Button variant="ghost" onClick={onBack} className="-ml-2 self-start">
          <ArrowLeft aria-hidden /> {backLabel}
        </Button>
      )}
      {loading && (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-7 w-2/3 rounded-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}
      {error && <EmptyState icon={Route} title={tp('loadError')}>{tp('loadErrorBody')}</EmptyState>}
      {sheet && (
        <>
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap gap-2">
              {visibility && <TrackVisibilityBadge value={visibility} />}
              {sheet.status === 'draft' && <Badge variant="outline"><PencilLine aria-hidden className="size-4" /> {t('draft')}</Badge>}
              {sheet.difficulty && <DifficultyBadge level={sheet.difficulty} />}
              {sheet.source === 'geotrek' && <Badge variant="outline"><BadgeCheck aria-hidden className="size-4" /> {t('official')}</Badge>}
              {sheet.loop ? <Badge>{t('loop')}</Badge> : <Badge variant="outline">{t('oneway')}</Badge>}
            </div>
            <SourceInfo sheet={sheet} />
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat icon={Route} label={t('stats.distance')} value={formatKm(sheet.distanceM / 1000, locale)} />
            <Stat icon={TrendingUp} label={t('stats.gain')} value={m(sheet.gainM)} />
            <Stat icon={TrendingDown} label={t('stats.loss')} value={m(sheet.lossM)} />
            <Stat icon={MoveDown} label={t('stats.minEle')} value={m(sheet.minEle)} />
            <Stat icon={Mountain} label={t('stats.maxEle')} value={m(sheet.maxEle)} />
            <Stat icon={Clock} label={t('stats.duration')} value={formatDuration(sheet.durationMin, locale)} />
          </dl>
          <p className="-mt-1 text-caption text-muted-foreground">{t('durationHint')}</p>
          {sheet.description && <p className="text-body break-words whitespace-pre-line">{sheet.description}</p>}
          {sheet.outings.length > 0 && (
            <section aria-label={t('outingsRegion')} className="flex flex-col gap-2">
              <h3 className="text-heading">{t('outingsOn')}</h3>
              <ul className="flex flex-col gap-2">
                {sheet.outings.map((o) => (
                  <li key={o.slug}>
                    <Link href={`/s/${o.slug}`} className="flex min-h-touch items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-2 transition-colors duration-150 hover:bg-accent/40 active:bg-accent/60">
                      <span className="min-w-0 truncate font-semibold">{o.title}</span>
                      <span className="shrink-0 text-small text-muted-foreground">{formatOutingDate(new Date(o.startsAt), locale)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Pied du panneau : profil d'altitude synchronisé avec la carte, puis « Préparer une sortie », GPX et menu « … ». */
/** `signedIn=false` (visiteur, #1591) : « Préparer une sortie » et « Modifier une copie » mènent à la connexion, qui ramène sur la même vue. */
export function TrackPanelFooter({ sheet, cursor, onScrub, compact, onVisibility, signedIn = true }: { sheet: PanelSheet; cursor: number | null; onScrub: (i: number | null) => void; compact: boolean; onVisibility?: (v: TrackVisibilityValue) => void; signedIn?: boolean }) {
  const t = useTranslations('track');
  const tp = useTranslations('explorer.panel');
  const tv = useTranslations('trackVisibility');
  const [more, setMore] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const moreId = useId();
  const draft = sheet.status === 'draft';
  const name = sheet.name || t('untitled');

  /** #1590 : change la visibilité (auteur seulement) par `PATCH /api/tracks/<slug>`. */
  async function changeVisibility(next: TrackVisibilityValue) {
    if (next === sheet.visibility) return;
    setBusy(true);
    const res = await fetch(`/api/tracks/${encodeURIComponent(sheet.slug)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visibility: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return void toast.error(tv('error'));
    onVisibility?.(next);
    toast.success(tv('saved'));
  }

  async function share() {
    const url = `${window.location.origin}/t/${sheet.slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success(tp('copied'));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error(tp('copyFailed'));
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="track-panel-footer">
      {sheet.profile.length > 1 && (
        <ElevationProfile points={sheet.profile} slopes legend={false} compact={compact} cursor={cursor} onScrub={(p) => onScrub(p ? p.index : null)} />
      )}
      {more && (
        <div id={moreId} className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline">
            <a href={`/api/t/${sheet.slug}/kml`} download aria-label={t('downloadKmlLabel')}>
              <Download aria-hidden /> {t('downloadKml')}
            </a>
          </Button>
          <Button variant="outline" onClick={() => void share()}>
            <Share2 aria-hidden /> {tp('share')}
          </Button>
          {sheet.rights.edit && !draft && (
            <Button asChild variant="outline"><Link href={`/t/${sheet.slug}/edit`}><Pencil aria-hidden /> {t('edit')}</Link></Button>
          )}
          {/* Visiteur (#1591) : l'API ne lui donne aucun droit ; le bouton reste visible et mène à la connexion. */}
          {(sheet.rights.copy || (!signedIn && !draft)) && (
            <Button asChild variant="outline">
              {signedIn ? <Link href={`/t/${sheet.slug}/edit?copie=1`}><Copy aria-hidden /> {t('editCopy')}</Link> : <LoginLink><Copy aria-hidden /> {t('editCopy')}</LoginLink>}
            </Button>
          )}
          {sheet.rights.delete && <DeleteTrackButton slug={sheet.slug} name={name} />}
          {sheet.rights.edit && sheet.visibility && (
            <Button variant="outline" aria-expanded={choosing} aria-label={tv('changeAria')} onClick={() => setChoosing((o) => !o)} className="col-span-2">
              {tv('change', { value: tv(sheet.visibility) })}
            </Button>
          )}
        </div>
      )}
      {more && choosing && sheet.rights.edit && sheet.visibility && (
        <TrackVisibilityChips value={sheet.visibility} onChange={(v) => void changeVisibility(v)} disabled={busy} />
      )}
      <div className="flex gap-2">
        {draft ? (
          <Button asChild size="lg" className="min-w-0 flex-1"><Link href={`/t/${sheet.slug}/edit`}><Pencil aria-hidden /> {t('continueDraft')}</Link></Button>
        ) : (
          <Button asChild size="lg" className="min-w-0 flex-1">
            {signedIn ? <Link href={`/sorties/nouvelle?trace=${sheet.slug}`}><CalendarPlus aria-hidden /> {tp('prepareOuting')}</Link> : <LoginLink><CalendarPlus aria-hidden /> {tp('prepareOuting')}</LoginLink>}
          </Button>
        )}
        <Button asChild size="lg" variant="outline" className="w-auto shrink-0">
          <a href={`/api/t/${sheet.slug}/gpx`} download aria-label={t('downloadGpx')}>
            <Download aria-hidden /> {tp('gpx')}
          </a>
        </Button>
        <Button size="icon" variant="outline" className="size-12 shrink-0" aria-label={more ? tp('less') : tp('more')} aria-expanded={more} aria-controls={moreId} onClick={() => setMore((o) => !o)}>
          <Ellipsis aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** Tracé de la trace ouverte sur la carte de l'explorateur : couleurs de pente, bornes km, arrivée, curseur du profil. */
export function OpenTrackLayers({ sheet, colors, mapRef, marked, beforeId }: { sheet: OpenLine; colors: MapColors; mapRef: RefObject<MapRef | null>; marked: number | null; beforeId?: string }) {
  const t = useTranslations('track');
  const data = useMemo(() => slopeFeatures(sheet.geometry), [sheet.geometry]);
  const point = marked !== null ? sheet.profile[marked] : undefined;
  return (
    <>
      <SlopeRouteLayer id="open" data={data} colors={colors} beforeId={beforeId} />
      <KmMarkers geometry={sheet.geometry} />
      <Marker longitude={sheet.end[0]} latitude={sheet.end[1]} anchor="bottom">
        <span className={cn('flex size-9 items-center justify-center rounded-full bg-foreground text-background shadow-md')} role="img" aria-label={t('end')}><Flag className="size-5" /></span>
      </Marker>
      {point && <ProfileCursorMarker mapRef={mapRef} lon={point.lon} lat={point.lat} />}
    </>
  );
}

type OutingTrackState = { id: string; track?: OpenLine; error?: boolean };

/** Parcours figé de la sortie ouverte dans le panneau (#1596), chargé à la demande (`GET /api/outings/map/<id>`). */
export function useOutingTrack(id: string | null) {
  const [state, setState] = useState<OutingTrackState | null>(null);
  useEffect(() => {
    if (!id) return;
    const ctl = new AbortController();
    fetch(`/api/outings/map/${encodeURIComponent(id)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((track: OpenLine) => setState({ id, track }))
      .catch((e) => e.name !== 'AbortError' && setState({ id, error: true }));
    return () => ctl.abort();
  }, [id]);
  const current = id && state?.id === id ? state : null;
  return current?.track;
}
