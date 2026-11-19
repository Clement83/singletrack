import { Navigation } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { OrganizerWord } from '@/components/outings/organizer-word';
import { OutingSection } from '@/components/outings/outing-section';
import { OpenSection } from '@/components/outings/section-toggle';
import { useLocale, useTranslations } from 'next-intl';
import { OutingBadges } from '@/components/outings/outing-badges';
import { TrackDetail } from '@/components/tracks/track-detail';
import { OutingRoute } from '@/components/outings/outing-route';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';
import { directionsUrl } from '@/lib/outings/labels';
import { profileFor } from '@/lib/outings/profile';
import type { TrackSnapshot } from '@/lib/outings/snapshot';
import type { OutingRow } from '@/db/schema';

/** Route shown: never the slug of the original track (#1592). */
export type OutingViewTrack = Pick<TrackSnapshot, 'name' | 'geometry' | 'bbox' | 'start' | 'distanceM' | 'elevationGainM' | 'attribution' | 'license'>;

export type OutingViewRole = 'organizer' | 'guest' | 'visitor' | 'anonymous';

export type OutingViewOuting = Pick<OutingRow, 'title' | 'startsAt' | 'level' | 'ebike' | 'meetingLabel' | 'meetingLat' | 'meetingLon' | 'description'> & {
  visibility?: OutingRow['visibility'];
  cancelled?: boolean;
  done?: boolean;
};

type Props = {
  /** Who is looking: only changes the actions (passed as slots), never the visuals. */
  role: OutingViewRole;
  /** `page` = full page; `panel` = map panel (no conditions, rides, photos, comments or embedded map). */
  presentation: 'page' | 'panel';
  outing: OutingViewOuting;
  /** Absent (outing from another server without a route) ⇒ route block hidden. */
  track: OutingViewTrack | null;
  /** Back link, above the header. */
  topLink?: React.ReactNode;
  /** Group-link share button (header). */
  headerAction?: React.ReactNode;
  /** The organiser's "…" menu (page only, #1619). */
  headerMenu?: React.ReactNode;
  /** First name of the organiser: "Organised by X" and avatar of the organiser's note (page only). */
  organizerName?: string;
  /** "Conditions" line of the identity card (page); a tap opens the Conditions section. */
  conditionsLine?: React.ReactNode;
  /** State banners under the badges (frozen public outing, cancelled, full, past). */
  notices?: React.ReactNode;
  /** "Next step" card (#1620), under the identity card (page only). */
  nextStep?: React.ReactNode;
  /** Main action: Answer / Manage / Join / Sign in. */
  primaryAction?: React.ReactNode;
  /** Sentence under the route title (original track, attribution). */
  trackNote?: React.ReactNode;
  conditions?: React.ReactNode;
  /** Verdict shown right of the Conditions section title, section closed or open (#1638). */
  conditionsSummary?: React.ReactNode;
  participants?: React.ReactNode;
  /** Share, invite friends, management. */
  secondaryActions?: React.ReactNode;
  /** Rides and photos. */
  activity?: React.ReactNode;
  /** Fixed bottom bar (#1622, page only): main action + discussion bubble. */
  bar?: React.ReactNode;
};

/**
 * Single view of an outing (#1597): same blocks, same order everywhere. The component makes no network call;
 * the caller decides the actions according to `outingPermissions` and passes them in the slots.
 * Order (`panel`): header → main action → meeting point + directions → description → route → who's coming. The `page`
 * presentation (#1619) is in `PageView`.
 */
export function OutingView({ role, presentation, outing: o, track: snap, topLink, headerAction, headerMenu, organizerName, conditionsLine, notices, nextStep, primaryAction, trackNote, conditions, conditionsSummary, participants, secondaryActions, activity, bar }: Props) {
  const locale = useLocale();
  const t = useTranslations('share');
  const tg = useTranslations('guest');
  const panel = presentation === 'panel';
  const end = snap && (snap.geometry.type === 'LineString' ? snap.geometry.coordinates : snap.geometry.coordinates.flat()).at(-1);
  if (!panel) return <PageView {...{ role, outing: o, snap, end, topLink, headerAction, headerMenu, organizerName, conditionsLine, notices, nextStep, primaryAction, trackNote, conditions, conditionsSummary, participants, secondaryActions, activity, bar }} />;
  return (
    <div data-outing-view={presentation} data-role={role} className={cn('flex flex-col gap-5', bar && 'pb-[calc(6rem+env(safe-area-inset-bottom))]')}>
      {topLink}
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-title">{o.title}</h1>
          {headerAction}
        </div>
        <p className="text-heading">{formatOutingDate(o.startsAt, locale)}</p>
        <OutingBadges visibility={o.visibility} level={o.level} ebike={o.ebike} cancelled={o.cancelled} done={o.done} />
        {notices}
      </header>

      {primaryAction}

      <section aria-label={tg('meetingRegion')} className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-small text-muted-foreground">{tg('meeting', { place: o.meetingLabel ?? t('meetingFallback') })}</p>
        <Button asChild variant="outline">
          <a href={directionsUrl(o.meetingLat, o.meetingLon)} target="_blank" rel="noopener noreferrer"><Navigation aria-hidden /> {tg('directions')}</a>
        </Button>
      </section>

      {o.description && <p className="whitespace-pre-line break-words">{o.description}</p>}

      {snap && end && <section aria-label={tg('trackRegion')} className="flex flex-col gap-3">
        <h2 className="text-heading">{snap.name}</h2>
        <p className="text-small text-muted-foreground">
          {formatKm(snap.distanceM / 1000, locale)}
          {snap.elevationGainM != null ? ` · ${formatElevation(snap.elevationGainM, locale)}` : ''}
        </p>
        {trackNote}
        {!panel && <TrackDetail geometry={snap.geometry} bbox={snap.bbox} start={snap.start} end={[end[0], end[1]]} profile={profileFor(snap.geometry)} />}
        {(snap.attribution || snap.license) && (
          <p className="text-caption text-muted-foreground">{[snap.attribution, snap.license && tg('license', { license: snap.license })].filter(Boolean).join(' · ')}</p>
        )}
      </section>}

      {!panel && conditions}
      {participants}
      {!panel && secondaryActions}
      {!panel && activity}
    </div>
  );
}

type PageProps = Pick<Props, 'role' | 'topLink' | 'headerAction' | 'headerMenu' | 'organizerName' | 'conditionsLine' | 'notices' | 'nextStep' | 'primaryAction' | 'trackNote' | 'conditions' | 'conditionsSummary' | 'participants' | 'secondaryActions' | 'activity' | 'bar'> & {
  outing: OutingViewOuting;
  snap: OutingViewTrack | null;
  end: number[] | null | undefined | false;
};

/**
 * Page presentation (#1619): header → identity card → main action ("Next step" slot, P2) →
 * route (P3) → collapsed sections (Conditions, Rides and photos) → guest actions → fixed bottom bar (#1622: main action + bubble; comments are in the sheet).
 */
function PageView({ role, outing: o, snap, end, topLink, headerAction, headerMenu, organizerName, conditionsLine, notices, nextStep, primaryAction, trackNote, conditions, conditionsSummary, participants, secondaryActions, activity, bar }: PageProps) {
  const locale = useLocale();
  const t = useTranslations('share');
  const tg = useTranslations('guest');
  const tv = useTranslations('outingView');
  const tl = useTranslations('outingLabels');
  const tvis = useTranslations('outingVisibility');
  return (
    <div data-outing-view="page" data-role={role} className={cn('flex flex-col gap-5', bar && 'pb-[calc(6rem+env(safe-area-inset-bottom))]')}>
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">{topLink}</div>
        <div className="flex shrink-0 items-center gap-2">{headerAction}{headerMenu}</div>
      </header>

      <section aria-labelledby="outing-title" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {o.done && !o.cancelled && <Badge variant="success">{tl('status.done')}</Badge>}
          {o.cancelled && <Badge variant="danger">{tl('status.cancelled')}</Badge>}
          {o.visibility && o.visibility !== 'invite' && <Badge variant="outline">{tvis(`badge.${o.visibility}`)}</Badge>}
          {organizerName && <p className="min-w-0 text-small text-muted-foreground">{tv('organizedBy', { name: organizerName })}</p>}
        </div>
        <h1 id="outing-title" className="text-display text-balance">{o.title}</h1>
        <p className="text-heading tabular-nums">{formatOutingDate(o.startsAt, locale)}</p>
        {notices}
        {o.description && <OrganizerWord name={organizerName ?? o.title} text={o.description} />}
        <section aria-label={tg('meetingRegion')} className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <p className="min-w-0 text-body">{tg('meeting', { place: o.meetingLabel ?? t('meetingFallback') })}</p>
          <Button asChild variant="outline">
            <a href={directionsUrl(o.meetingLat, o.meetingLon)} target="_blank" rel="noopener noreferrer"><Navigation aria-hidden /> {tg('directions')}</a>
          </Button>
        </section>
        <p className="flex flex-wrap items-baseline gap-x-2 border-t border-border pt-3 text-stat tabular-nums">
          {snap && <span>{formatKm(snap.distanceM / 1000, locale)}</span>}
          {snap?.elevationGainM != null && <><span aria-hidden className="text-muted-foreground">·</span><span>{formatElevation(snap.elevationGainM, locale)}</span></>}
          <span aria-hidden className="text-muted-foreground">·</span>
          <span>{tl(`level.${o.level}`)}</span>
          {o.ebike !== 'no' && <><span aria-hidden className="text-muted-foreground">·</span><span className="text-body font-normal">{tl(`ebike.${o.ebike}`)}</span></>}
        </p>
        {conditionsLine && <OpenSection target="conditions-section" label={tv('openConditions')}>{conditionsLine}</OpenSection>}
        {participants}
      </section>

      {nextStep}
      {primaryAction}

      {snap && end && <section aria-label={tg('trackRegion')} className="flex flex-col gap-3">
        <h2 className="text-heading">{snap.name}</h2>
        {trackNote}
        <OutingRoute name={snap.name} geometry={snap.geometry} bbox={snap.bbox} start={snap.start} end={[end[0], end[1]]} distanceM={snap.distanceM} elevationGainM={snap.elevationGainM} profile={profileFor(snap.geometry)} />
        {(snap.attribution || snap.license) && (
          <p className="text-caption text-muted-foreground">{[snap.attribution, snap.license && tg('license', { license: snap.license })].filter(Boolean).join(' · ')}</p>
        )}
      </section>}

      {conditions && <OutingSection id="conditions-section" title={tv('conditions')} summary={conditionsSummary}>{conditions}</OutingSection>}
      {activity && <OutingSection id="activity-section" title={tv('activity')}>{activity}</OutingSection>}
      {secondaryActions}
      {bar}
    </div>
  );
}
