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
import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';
import { directionsUrl } from '@/lib/outings/labels';
import { profileFor } from '@/lib/outings/profile';
import type { TrackSnapshot } from '@/lib/outings/snapshot';
import type { OutingRow } from '@/db/schema';

/** Parcours affiché : jamais le slug de la trace d'origine (#1592). */
export type OutingViewTrack = Pick<TrackSnapshot, 'name' | 'geometry' | 'bbox' | 'start' | 'distanceM' | 'elevationGainM' | 'attribution' | 'license'>;

export type OutingViewRole = 'organizer' | 'guest' | 'visitor' | 'anonymous';

export type OutingViewOuting = Pick<OutingRow, 'title' | 'startsAt' | 'level' | 'ebike' | 'meetingLabel' | 'meetingLat' | 'meetingLon' | 'description'> & {
  visibility?: OutingRow['visibility'];
  cancelled?: boolean;
  done?: boolean;
};

type Props = {
  /** Qui regarde : ne change que les actions (passées en slots), jamais le visuel. */
  role: OutingViewRole;
  /** `page` = page complète ; `panel` = panneau de la carte (sans conditions, roulées, photos, commentaires ni carte embarquée). */
  presentation: 'page' | 'panel';
  outing: OutingViewOuting;
  /** Absent (sortie d'un autre serveur sans parcours) ⇒ bloc parcours masqué. */
  track: OutingViewTrack | null;
  /** Lien de retour, au-dessus de l'en-tête. */
  topLink?: React.ReactNode;
  /** Bouton de partage du lien de groupe (en-tête). */
  headerAction?: React.ReactNode;
  /** Menu « … » de l'organisateur (page seulement, #1619). */
  headerMenu?: React.ReactNode;
  /** Prénom de l'organisateur : « Organisée par X » et avatar du mot de l'organisateur (page seulement). */
  organizerName?: string;
  /** Ligne « conditions » de la carte d'identité (page) ; un tap ouvre la section Conditions. */
  conditionsLine?: React.ReactNode;
  /** Bandeaux d'état sous les badges (sortie publique figée, annulée, complète, passée). */
  notices?: React.ReactNode;
  /** Encart « Prochaine étape » (#1620), sous la carte d'identité (page seulement). */
  nextStep?: React.ReactNode;
  /** Action principale : Répondre / Gérer / Rejoindre / Se connecter. */
  primaryAction?: React.ReactNode;
  /** Phrase sous le titre du parcours (trace d'origine, attribution). */
  trackNote?: React.ReactNode;
  conditions?: React.ReactNode;
  participants?: React.ReactNode;
  /** Partage, inviter des copains, gestion. */
  secondaryActions?: React.ReactNode;
  /** Sorties roulées et photos. */
  activity?: React.ReactNode;
  comments?: React.ReactNode;
};

/**
 * Vue unique d'une sortie (#1597) : mêmes blocs, même ordre partout. Le composant ne fait aucun appel réseau ;
 * l'appelant décide des actions selon `outingPermissions` et les passe dans les emplacements.
 * Ordre (`panel`) : en-tête → action principale → RDV + itinéraire → description → parcours → qui vient. La présentation
 * `page` (#1619) est dans `PageView`.
 */
export function OutingView({ role, presentation, outing: o, track: snap, topLink, headerAction, headerMenu, organizerName, conditionsLine, notices, nextStep, primaryAction, trackNote, conditions, participants, secondaryActions, activity, comments }: Props) {
  const locale = useLocale();
  const t = useTranslations('share');
  const tg = useTranslations('guest');
  const panel = presentation === 'panel';
  const end = snap && (snap.geometry.type === 'LineString' ? snap.geometry.coordinates : snap.geometry.coordinates.flat()).at(-1);
  if (!panel) return <PageView {...{ role, outing: o, snap, end, topLink, headerAction, headerMenu, organizerName, conditionsLine, notices, nextStep, primaryAction, trackNote, conditions, participants, secondaryActions, activity, comments }} />;
  return (
    <div data-outing-view={presentation} data-role={role} className="flex flex-col gap-5">
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
      {!panel && comments}
    </div>
  );
}

type PageProps = Pick<Props, 'role' | 'topLink' | 'headerAction' | 'headerMenu' | 'organizerName' | 'conditionsLine' | 'notices' | 'nextStep' | 'primaryAction' | 'trackNote' | 'conditions' | 'participants' | 'secondaryActions' | 'activity' | 'comments'> & {
  outing: OutingViewOuting;
  snap: OutingViewTrack | null;
  end: number[] | null | undefined | false;
};

/**
 * Présentation page (#1619) : en-tête → carte d'identité → action principale (emplacement « Prochaine étape », P2) →
 * parcours (P3) → sections repliées (Conditions, Roulées et photos) → actions des invités → commentaires (P4).
 */
function PageView({ role, outing: o, snap, end, topLink, headerAction, headerMenu, organizerName, conditionsLine, notices, nextStep, primaryAction, trackNote, conditions, participants, secondaryActions, activity, comments }: PageProps) {
  const locale = useLocale();
  const t = useTranslations('share');
  const tg = useTranslations('guest');
  const tv = useTranslations('outingView');
  const tl = useTranslations('outingLabels');
  const tvis = useTranslations('outingVisibility');
  return (
    <div data-outing-view="page" data-role={role} className="flex flex-col gap-5">
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
        <section aria-label={tg('meetingRegion')} className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-body">{tg('meeting', { place: o.meetingLabel ?? t('meetingFallback') })}</p>
          <Button asChild variant="outline">
            <a href={directionsUrl(o.meetingLat, o.meetingLon)} target="_blank" rel="noopener noreferrer"><Navigation aria-hidden /> {tg('directions')}</a>
          </Button>
        </section>
        <p className="flex flex-wrap items-baseline gap-x-2 text-stat tabular-nums">
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

      {conditions && <OutingSection id="conditions-section" title={tv('conditions')}>{conditions}</OutingSection>}
      {activity && <OutingSection id="activity-section" title={tv('activity')}>{activity}</OutingSection>}
      {secondaryActions}
      {comments}
    </div>
  );
}
